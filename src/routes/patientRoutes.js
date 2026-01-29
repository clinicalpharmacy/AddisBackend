import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, getUserAccessibleData } from '../middleware/authMiddleware.js';
import { sanitizeSearchQuery } from '../utils/helpers.js';

const router = express.Router();

// Get all patients with role-based filtering
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type || 'individual';

        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);

        let query = supabase.from('patients').select('*');

        if (userRole === 'admin') {
            // Admin sees all
        } else if (userAccountType === 'company_user' || userRole === 'company_admin') {
            query = query.in('user_id', accessibleUserIds);
        } else {
            query = query.eq('user_id', userId);
        }

        const { data: patients, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            patients: patients || [],
            count: patients?.length || 0,
            access_info: { role: userRole }
        });

    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Get own patients
router.get('/my-patients', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: patients, error } = await supabase.from('patients').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) throw error;

        res.json({ success: true, patients: patients || [], count: patients?.length || 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Legacy Get by code - MUST come before /:identifier
router.get('/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type || 'individual';

        let query = supabase.from('patients').select('*').eq('patient_code', patientCode);

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            query = query.in('user_id', accessibleUserIds);
        }

        const { data, error } = await query.maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Patient not found' });

        res.json({ success: true, patient: data });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message || 'Failed' });
    }
});

// Get by identifier (ID or Code) - MUST come LAST among GET routes
router.get('/:identifier', authenticateToken, async (req, res) => {
    try {
        const identifier = req.params.identifier;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type || 'individual';

        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        let query = supabase.from('patients').select('*');

        // Determine if identifier is UUID or Code
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier);

        if (isUUID) {
            query = query.eq('id', identifier);
        } else {
            query = query.eq('patient_code', identifier);
        }

        // Apply access control
        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            query = query.in('user_id', accessibleUserIds);
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            return res.status(404).json({ success: false, error: 'Patient not found or access denied' });
        }

        res.json({ success: true, patient: data });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch patient data',
            details: error
        });
    }
});

// Create patient
router.post('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userAccountType = req.user.account_type || 'individual';
        const patientData = req.body;

        if (!patientData.full_name) {
            return res.status(400).json({ success: false, error: 'Patient name is required' });
        }

        // ✅ INDIVIDUAL SUBSCRIPTION LIMIT: Only 1 patient allowed (Exempt company users)
        if (userAccountType === 'individual' && !req.user.company_id) {
            const { data: existingPatients, error: countError } = await supabase
                .from('patients')
                .select('id', { count: 'exact' })
                .eq('user_id', userId);

            if (countError) {
                return res.status(500).json({ success: false, error: 'Failed to verify patient limit' });
            }

            if (existingPatients && existingPatients.length >= 1) {
                return res.status(403).json({
                    success: false,
                    error: 'Patient limit reached',
                    message: 'Individual subscription allows only 1 patient. Please upgrade to Company subscription for unlimited patients.',
                    limit: 1,
                    current: existingPatients.length
                });
            }
        }

        let user_id = userId;
        let created_by = userId;

        // --- CONSTRAINT FIX: Sync user to 'users' table if missing (for company users) ---
        if ((req.user.account_type === 'company_user' || req.user.role === 'company_admin') && userId) {
            try {
                const db = supabaseAdmin || supabase;
                const { data: exists } = await db.from('users').select('id').eq('id', userId).maybeSingle();
                if (!exists) {


                    // Fetch source record to get password_hash and other required fields
                    const { data: sourceUser } = await db.from('company_users').select('*').eq('id', userId).maybeSingle();

                    if (sourceUser) {
                        const { error: syncErr } = await db.from('users').insert([{
                            id: userId,
                            email: sourceUser.email,
                            full_name: sourceUser.full_name,
                            role: sourceUser.role,
                            company_id: sourceUser.company_id,
                            approved: true,
                            password_hash: sourceUser.password_hash || 'SYNCED_PROVIDER' // Satisfy not-null constraint
                        }]);

                        if (syncErr) {
                            console.error('❌ [FIX] Sync failed:', syncErr.message);
                        } else {

                        }
                    } else {
                        console.warn('⚠️ [FIX] Source user not found in company_users, cannot sync.');
                    }
                }
            } catch (err) { console.warn('Sync exception:', err.message); }
        }
        // -------------------------------------------------------------------------------

        // Note: We no longer force patient ownership to the company admin here.
        // The data isolation logic in authMiddleware now handles shared access 
        // by returning all user IDs in the company.

        const patientToCreate = {
            ...patientData,
            user_id: patientData.user_id && patientData.user_id !== 'admin' ? patientData.user_id : user_id,
            created_by: created_by,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        delete patientToCreate.id;

        if (!patientToCreate.patient_code) {
            const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            patientToCreate.patient_code = `PAT${new Date().getFullYear().toString().slice(-2)}${(new Date().getMonth() + 1).toString().padStart(2, '0')}${new Date().getDate().toString().padStart(2, '0')}${rnd}`;
        }

        // Clean empty values
        Object.keys(patientToCreate).forEach(k => {
            if (typeof patientToCreate[k] === 'string' && !patientToCreate[k].trim()) {
                patientToCreate[k] = null;
            }
        });

        const targetDb = supabaseAdmin || supabase;
        const { data, error } = await targetDb.from('patients').insert([patientToCreate]).select().single();

        if (error) {
            if (error.code === '23503') { // Foreign key retry
                // If it's still failing, we might need to check if user_id even exists in users table
            }
            throw error;
        }

        res.status(201).json({ success: true, message: 'Created', patient: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

// Update patient (by ID or Code)
router.put('/:identifier', authenticateToken, async (req, res) => {
    try {
        const identifier = req.params.identifier;
        const userId = req.user.userId;
        const userRole = req.user.role;

        const isUuid = identifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

        let query = supabase.from('patients').select('*');
        if (isUuid) {
            query = query.eq('id', identifier);
        } else {
            query = query.eq('patient_code', identifier);
        }

        const { data: existing, error: fetchError } = await query.maybeSingle();
        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ success: false, error: 'Patient not found' });

        // Permission check: Admin or anyone with accessible ID (all company members)
        const accessibleIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const hasPermission = userRole === 'admin' || (accessibleIds && accessibleIds.includes(existing.user_id));

        if (!hasPermission) return res.status(403).json({ success: false, error: 'Access denied' });

        const updates = { ...req.body, updated_at: new Date().toISOString() };
        ['id', 'user_id', 'created_at', 'created_by', 'patient_code'].forEach(k => delete updates[k]);

        Object.keys(updates).forEach(k => {
            if (typeof updates[k] === 'string' && !updates[k].trim()) {
                updates[k] = null;
            }
        });

        const db = supabaseAdmin || supabase;
        const { data, error } = await db.from('patients').update(updates).eq('id', existing.id).select().single();
        if (error) throw error;

        res.json({ success: true, message: 'Updated', patient: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

// Update by code (Legacy support)
router.put('/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;

        const { data: existing, error: fetchError } = await supabase
            .from('patients')
            .select('*')
            .eq('patient_code', patientCode)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ success: false, error: 'Patient not found' });

        // Permission check
        const accessibleIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const hasPermission = userRole === 'admin' || (accessibleIds && accessibleIds.includes(existing.user_id));

        if (!hasPermission) return res.status(403).json({ success: false, error: 'Access denied' });

        const updates = { ...req.body, updated_at: new Date().toISOString() };
        ['id', 'user_id', 'created_at', 'created_by', 'patient_code'].forEach(k => delete updates[k]);

        const { data, error } = await supabase.from('patients').update(updates).eq('id', existing.id).select().single();
        if (error) throw error;

        res.json({ success: true, message: 'Updated', patient: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

// Delete by ID
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;
        const userId = req.user.userId;
        const userRole = req.user.role;

        const { data: patient } = await supabase.from('patients').select('user_id').eq('id', patientId).single();
        if (!patient) return res.status(404).json({ success: false, error: 'Not found' });

        const accessibleIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const isAdmin = userRole === 'admin';
        const isIndividual = req.user.account_type === 'individual';

        // Security: Individual users are not allowed to delete patients
        if (isIndividual && !isAdmin) {
            return res.status(403).json({ success: false, error: 'Individual subscription users cannot delete patient records. They can only update existing ones.' });
        }

        const hasPermission = isAdmin || (accessibleIds && accessibleIds.includes(patient.user_id));

        if (!hasPermission) return res.status(403).json({ success: false, error: 'Permission denied' });

        await supabase.from('patients').delete().eq('id', patientId);
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Delete by code (Legacy support)
router.delete('/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;

        const { data: patient } = await supabase
            .from('patients')
            .select('id, user_id')
            .eq('patient_code', patientCode)
            .single();

        if (!patient) return res.status(404).json({ success: false, error: 'Not found' });

        const accessibleIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const isAdmin = userRole === 'admin';
        const isIndividual = req.user.account_type === 'individual';

        // Security: Individual users are not allowed to delete patients
        if (isIndividual && !isAdmin) {
            return res.status(403).json({ success: false, error: 'Individual subscription users cannot delete patient records. They can only update existing ones.' });
        }

        const hasPermission = isAdmin || (accessibleIds && accessibleIds.includes(patient.user_id));

        if (!hasPermission) return res.status(403).json({ success: false, error: 'Permission denied' });

        const db = supabaseAdmin || supabase;
        await db.from('patients').delete().eq('id', patient.id);
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Search patients
router.get('/search/:query', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const rawQuery = req.params.query;

        const query = sanitizeSearchQuery(rawQuery);
        if (!query || query.length < 2) return res.status(400).json({ error: 'Query too short' });

        let dbQuery = supabase.from('patients').select('*')
            .or(`full_name.ilike.%${query}%,patient_code.ilike.%${query}%,contact_number.ilike.%${query}%,diagnosis.ilike.%${query}%`)
            .order('created_at', { ascending: false }).limit(50);

        if (userRole === 'admin') {
            // Admin sees all
        } else if (userRole === 'company_admin') {
            const accessibleIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
            dbQuery = dbQuery.in('user_id', accessibleIds);
        } else {
            dbQuery = dbQuery.eq('user_id', userId);
        }

        const { data, error } = await dbQuery;
        if (error) throw error;
        res.json({ success: true, patients: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

export default router;
