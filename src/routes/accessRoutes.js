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
        const { patient_id, owner_id } = req.body;
        const requester_id = req.user.userId || req.user.id;

        if (!owner_id) {
            return res.status(400).json({ success: false, error: 'Owner ID is required' });
        }

        // Check if a request already exists
        const { data: existing } = await db.from('access_requests')
            .select('id, status')
            .eq('patient_id', patient_id)
            .eq('requester_id', requester_id)
            .maybeSingle();

        if (existing) {
            return res.json({ success: true, message: 'Request already exists', status: existing.status });
        }

        const { data, error } = await db.from('access_requests').insert({
            patient_id,
            requester_id,
            owner_id,
            status: 'pending'
        }).select().single();

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

        if (!patient_id || !admin_id || !encrypted_key) {
            return res.status(400).json({ success: false, error: 'Target Admin, Patient, and Encrypted Key are required' });
        }

        // 🛡️ Robustness: Handle both UUID and Integer IDs
        const pidStr = String(patient_id || '');
        const isUUID = pidStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        const isNumeric = pidStr.match(/^\d+$/);

        if (!isUUID && !isNumeric) {
            console.warn(`⚠️ [Support] Invalid ID format for patient_id: ${patient_id}`);
            return res.status(400).json({ success: false, error: 'Valid Patient ID (UUID or Numeric) is required.' });
        }

        // Create or update access record with 'active' status
        const { data, error } = await db.from('access_requests')
            .upsert({
                patient_id,
                owner_id,
                requester_id: admin_id, // Admin is the receiver
                encrypted_key,
                status: 'approved',
                approved_at: new Date().toISOString()
            }, { 
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
                requester:requester_id(full_name, email),
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
 * ✅ APPROVE A REQUEST
 * Owner provides the encrypted patient key for the requester.
 */
router.post('/approve', authenticateToken, async (req, res) => {
    try {
        const { request_id, encrypted_key } = req.body;
        const owner_id = req.user.userId || req.user.id;

        if (!request_id || !encrypted_key) {
            return res.status(400).json({ success: false, error: 'Request ID and encrypted key are required' });
        }

        const { data, error } = await db.from('access_requests')
            .update({ 
                status: 'approved',
                encrypted_key,
                approved_at: new Date().toISOString()
            })
            .eq('id', request_id)
            .eq('owner_id', owner_id)
            .select().single();

        if (error) throw error;

        res.json({ success: true, request: data });
    } catch (err) {
        console.error('❌ [AccessRequest] Approval error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to approve request' });
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

        // 🛡️ Robustness: Handle both UUID and Integer IDs
        const pidStr = String(patient_id || '');
        const isUUID = pidStr.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        const isNumeric = pidStr.match(/^\d+$/);

        if (!isUUID && !isNumeric) {
            console.warn(`⚠️ [Access] Invalid ID format for patient_id: ${patient_id}`);
            return res.json({ success: true, message: 'Valid ID format required', request: null });
        }

        // AUTO-EXPIRY: Only fetch approved requests from the last 24 hours
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const { data, error } = await db.from('access_requests')
            .select('*')
            .eq('patient_id', patient_id)
            .eq('requester_id', requester_id)
            .eq('status', 'approved')
            .gt('approved_at', twentyFourHoursAgo) // Access expires after 24h
            .order('created_at', { ascending: false })
            .maybeSingle();

        if (error) throw error;

        res.json({ success: true, request: data });
    } catch (err) {
        console.error('❌ [Access] Granted check error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to verify secure access' });
    }
});

/**
 * 📋 GET ALL ACTIVE SUPPORT PATIENTS FOR ADMIN
 * Returns a list of patients the admin has been granted access to.
 */
router.get('/active-support', authenticateToken, async (req, res) => {
    try {
        const admin_id = req.user.userId || req.user.id;

        // Simple select without joins to troubleshoot sync errors
        const { data, error } = await db.from('access_requests')
            .select('*')
            .eq('requester_id', admin_id)
            .eq('status', 'approved');

        if (error) throw error;

        res.json({ success: true, support_patients: data || [] });
    } catch (err) {
        console.error('❌ [ActiveSupport] Fetch error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch assigned support patients' });
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
            .eq('owner_id', owner_id)
            .eq('status', 'approved');

        if (error) throw error;

        res.json({ success: true, message: 'Support access revoked successfully' });
    } catch (err) {
        console.error('❌ [RevokeSupport] Error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to revoke support access' });
    }
});

export default router;
