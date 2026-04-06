import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();
const db = supabaseAdmin || supabase;

/**
 * 📢 SUBMIT AN ACCESS REQUEST (Admin Initiated)
 * Admin requests to see a specific patient's data.
 */
router.post('/request', authenticateToken, async (req, res) => {
    try {
        const { patient_id, owner_id, requester_id: body_requester_id, encrypted_key, status: body_status } = req.body;
        // Determine the actual requester: body may pass requester_id when user grants access to admin
        const requester_id = body_requester_id || req.user.userId || req.user.id;
        const actual_owner_id = owner_id || req.user.userId || req.user.id;

        if (!actual_owner_id) {
            return res.status(400).json({ success: false, error: 'Owner ID is required' });
        }

        // Check if a request already exists between same owner & requester
        const { data: existing } = await db.from('access_requests')
            .select('id, status')
            .eq('owner_id', actual_owner_id)
            .eq('requester_id', requester_id)
            .is('patient_id', patient_id || null)
            .maybeSingle();

        if (existing) {
            // Update it if a new encrypted_key was provided
            if (encrypted_key) {
                await db.from('access_requests')
                    .update({ encrypted_key, status: body_status || existing.status, approved_at: new Date().toISOString() })
                    .eq('id', existing.id);
            }
            return res.json({ success: true, message: 'Request already exists', status: existing.status });
        }

        const insertPayload = {
            patient_id: patient_id || null,
            requester_id,
            owner_id: actual_owner_id,
            status: body_status === 'granted' ? 'approved' : 'pending',
        };

        if (encrypted_key) {
            insertPayload.encrypted_key = encrypted_key;
            insertPayload.approved_at = new Date().toISOString();
        }

        const { data, error } = await db.from('access_requests').insert(insertPayload).select().single();

        if (error) throw error;

        res.json({ success: true, request: data });
    } catch (err) {
        console.error('❌ [AccessRequest] Error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to create request' });
    }
});

/**
 * 🛠️ ACTIVATE SUPPORT ACCESS (User Initiated)
 * User proactively sends an encrypted key to an admin for troubleshooting.
 */
router.post('/support-activate', authenticateToken, async (req, res) => {
    try {
        const { patient_id, admin_id, encrypted_key } = req.body;
        const owner_id = req.user.userId || req.user.id;

        if (!admin_id || !encrypted_key) {
            return res.status(400).json({ success: false, error: 'Target Admin and Encrypted Key are required' });
        }

        // 🛡️ Robustness: Handle both UUID and Integer IDs
        const pidStr = String(patient_id || '');
        const isUUID = pidStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        const isNumeric = pidStr.match(/^\d+$/);

        if (!isUUID && !isNumeric) {
            console.warn(`⚠️ [Support] Invalid ID format for patient_id: ${patient_id}`);
            return res.status(400).json({ success: false, error: 'Valid Patient ID (UUID or Numeric) is required.' });
        }

        // Create or update access record with 'approved' status
        const upsertPayload = {
            patient_id: patient_id || null,
            owner_id,
            requester_id: admin_id, // Admin is the receiver
            encrypted_key,
            status: 'approved',
            approved_at: new Date().toISOString()
        };

        // Use upsert — ensure we don't create duplicates for the same (patient_id, requester_id, owner_id)
        // Note: For global grants, patient_id is null.
        const { data, error } = await db.from('access_requests')
            .upsert(upsertPayload, { 
                onConflict: 'patient_id, requester_id', 
                ignoreDuplicates: false 
            })
            .select().single();

        if (error) throw error;

        res.json({ success: true, message: 'Support access activated successfully', request: data });
    } catch (err) {
        console.error('❌ [SupportActivate] Error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to activate support access' });
    }
});

/**
 * 🔔 GET PENDING REQUESTS FOR THE OWNER
 * The patient creator sees who is asking for access.
 */
router.get('/pending', authenticateToken, async (req, res) => {
    try {
        const owner_id = req.user.userId || req.user.id;
        
        const { data, error } = await db.from('access_requests')
            .select(`
                *,
                requester:requester_id(full_name, email, public_key),
                patient:patient_id(full_name, patient_code)
            `)
            .eq('owner_id', owner_id)
            .eq('status', 'pending');

        if (error) throw error;

        res.json({ success: true, requests: data || [] });
    } catch (err) {
        console.error('❌ [AccessRequest] Fetch error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch requests' });
    }
});

/**
 * ✅ APPROVE A REQUEST (Admin or Owner)
 * Admin directly approves a pending data-sharing request.
 */
router.post('/approve', authenticateToken, async (req, res) => {
    try {
        const { request_id, encrypted_key } = req.body;
        const caller_id = req.user.userId || req.user.id;
        const is_admin = req.user.role === 'admin' || req.user.role === 'superadmin';

        if (!request_id) {
            return res.status(400).json({ success: false, error: 'Request ID is required' });
        }

        // Build query — admin can approve any record, owner can only approve their own
        let query = db.from('access_requests')
            .update({ 
                status: 'approved',
                ...(encrypted_key ? { encrypted_key } : {}),
                approved_at: new Date().toISOString()
            })
            .eq('id', request_id);

        if (!is_admin) {
            query = query.eq('owner_id', caller_id);
        }

        const { data, error } = await query.select().single();

        if (error) throw error;

        res.json({ success: true, request: data });
    } catch (err) {
        console.error('❌ [AccessRequest] Approval error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to approve request' });
    }
});

/**
 * ❌ REJECT / DELETE A REQUEST (Admin)
 * Admin deletes a pending data-sharing request they don't want to approve.
 */
router.post('/reject', authenticateToken, async (req, res) => {
    try {
        const { request_id } = req.body;
        if (!request_id) {
            return res.status(400).json({ success: false, error: 'Request ID is required' });
        }

        const { error } = await db.from('access_requests')
            .delete()
            .eq('id', request_id);

        if (error) throw error;

        res.json({ success: true, message: 'Request rejected and removed.' });
    } catch (err) {
        console.error('❌ [Reject] Error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to reject request' });
    }
});

/**
 * 🔑 GET GRANTED ACCESS FOR CURRENT USER
 * Admin checks if they were given a shared key for this patient.
 */
router.get('/granted', authenticateToken, async (req, res) => {
    try {
        const { patient_id } = req.query;
        const requester_id = req.user.userId || req.user.id;

        if (!patient_id) return res.status(400).json({ success: false, error: 'Patient ID is required' });

        // 1. Identify which user owns this patient (to support Global Grants)
        const { data: patient } = await db.from('patients').select('user_id').eq('id', patient_id).maybeSingle();
        const owner_id = patient?.user_id;

        // 2. Query for a Specific Grant for this patient OR a Global Grant for this User
        // We prioritize Specific grants by sorting NULL values (for global) to the end.
        const { data, error } = await db.from('access_requests')
            .select('*')
            .eq('requester_id', requester_id)
            .eq('status', 'approved')
            .or(`patient_id.eq.${patient_id},and(patient_id.is.null,owner_id.eq.${owner_id})`)
            .order('patient_id', { ascending: false, nullsFirst: false })
            .limit(1);

        if (error) throw error;

        res.json({ success: true, request: data?.[0] || null });
    } catch (err) {
        console.error('❌ [AccessRequest] Status check error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to verify access status' });
    }
});

/**
 * 📋 GET ALL ACTIVE SUPPORT PATIENTS FOR ADMIN
 * Returns a list of patients the admin has been granted access to.
 */
router.get('/active-support', authenticateToken, async (req, res) => {
    try {
        const admin_id = req.user.userId || req.user.id;

        // 1. Fetch authorized records (Treat both 'approved' and 'pending' as authorized for instant access)
        const { data: records, error } = await db.from('access_requests')
            .select('*')
            .eq('requester_id', admin_id)
            .in('status', ['approved', 'pending']); 

        if (error) throw error;
        if (!records || records.length === 0) return res.json({ success: true, support_patients: [] });

        // 2. Hydrate records with patient/owner metadata manually (Robust Join)
        const hydrated = await Promise.all(records.map(async (row) => {
            const { data: patient } = await db.from('patients').select('id, full_name, patient_code').eq('id', row.patient_id).maybeSingle();
            const { data: owner } = await db.from('users').select('full_name, email').eq('id', row.owner_id).maybeSingle();
            return { ...row, patient, owner };
        }));

        res.json({ success: true, support_patients: hydrated });
    } catch (err) {
        console.error('❌ [ActiveSupport] Fetch error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to access support vault.', details: err.message });
    }
});

/**
 * 🔔 GET ALL PENDING DATA SHARING REQUESTS FOR ADMIN
 * Admin can see all users who have requested data sharing (pending/granted status).
 */
router.get('/pending-admin', authenticateToken, async (req, res) => {
    try {
        // 1. Fetch raw pending records
        const { data: records, error } = await db.from('access_requests')
            .select('*')
            .in('status', ['pending', 'granted'])
            .order('created_at', { ascending: false });

        if (error) throw error;
        if (!records || records.length === 0) return res.json({ success: true, requests: [] });

        // 2. Hydrate metadata
        const hydrated = await Promise.all(records.map(async (row) => {
            const { data: owner } = await db.from('users').select('id, full_name, email').eq('id', row.owner_id).maybeSingle();
            const { data: patient } = row.patient_id 
                ? await db.from('patients').select('id, full_name, patient_code').eq('id', row.patient_id).maybeSingle()
                : { data: null };
            return { ...row, owner, patient };
        }));

        res.json({ success: true, requests: hydrated });
    } catch (err) {
        console.error('❌ [PendingAdmin] Fetch error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch pending requests.', details: err.message });
    }
});

/**
 * 🔓 REVOKE SUPPORT ACCESS
 * Owner terminates an active support session for a specific patient.
 */
router.post('/revoke-support', authenticateToken, async (req, res) => {
    try {
        const { patient_id } = req.body;
        const owner_id = req.user.userId || req.user.id;

        if (!patient_id) return res.status(400).json({ success: false, error: 'Patient ID is required' });

        const { error } = await db.from('access_requests')
            .delete()
            .eq('patient_id', patient_id)
        // Build query
        let query = db.from('access_requests')
            .delete()
            .eq('owner_id', owner_id)
            .eq('status', 'approved');

        if (patient_id) {
            query = query.eq('patient_id', patient_id);
        } else {
            query = query.is('patient_id', null);
        }

        const { error: deleteError } = await query;

        if (deleteError) throw deleteError;

        res.json({ success: true, message: 'Support access revoked successfully' });
    } catch (err) {
        console.error('❌ [RevokeSupport] Error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to revoke support access' });
    }
});

/**
 * 🔒 GET MY ACTIVE GRANTS
 * The owner sees current active troubleshooting grants they've authorized.
 */
router.get('/my-active-grants', authenticateToken, async (req, res) => {
    try {
        const owner_id = req.user.userId || req.user.id;
        
        const { data: grants, error: fetchError } = await db.from('access_requests')
            .select(`
                *,
                requester:requester_id(id, full_name, email)
            `)
            .eq('owner_id', owner_id)
            .eq('status', 'approved');

        if (fetchError) throw fetchError;

        res.json({ success: true, grants: grants || [] });
    } catch (err) {
        console.error('❌ [MyActiveGrants] Error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch active grants' });
    }
});

export default router;
