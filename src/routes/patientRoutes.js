import express from 'express';
import { supabase } from '../config/supabase.js';
import { debug } from '../utils/logger.js';
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
        debug.error('Get patients error:', error);
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

        debug.log(`🔍 Fetching patient by code: ${patientCode} for user ${userId}`);

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
        debug.error('Get patient by code error:', error);
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

        debug.log(`🔍 Fetching patient by identifier: ${identifier} for user ${userId}`);

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
            debug.error('Supabase fetch error:', error);
            throw error;
        }

        if (!data) {
            debug.warn(`Patient not found with identifier: ${identifier}`);
            return res.status(404).json({ success: false, error: 'Patient not found or access denied' });
        }

        res.json({ success: true, patient: data });

    } catch (error) {
        debug.error('Get patient by identifier error:', error);
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

        debug.log(`➕ Creating patient for user ${userId} (${userAccountType})`, { name: patientData.full_name });

        if (!patientData.full_name) {
            return res.status(400).json({ success: false, error: 'Patient name is required' });
        }

        // ✅ INDIVIDUAL SUBSCRIPTION LIMIT: Only 1 patient allowed
        if (userAccountType === 'individual') {
            const { data: existingPatients, error: countError } = await supabase
                .from('patients')
                .select('id', { count: 'exact' })
                .eq('user_id', userId);

            if (countError) {
                debug.error('Error checking patient count:', countError);
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

        const { data, error } = await supabase.from('patients').insert([patientToCreate]).select().single();

        if (error) {
            debug.error('❌ Supabase patient insert error:', error);
            if (error.code === '23503') { // Foreign key retry
                debug.warn('Retrying insert without created_by...');
                delete patientToCreate.created_by;
                const { data: d2, error: e2 } = await supabase.from('patients').insert([patientToCreate]).select().single();
                if (e2) throw e2;
                return res.status(201).json({ success: true, patient: d2 });
            }
            throw error;
        }

        debug.success(`✅ Patient created: ${data.id} (${data.patient_code})`);
        res.status(201).json({ success: true, message: 'Created', patient: data });
    } catch (e) {
        debug.error('❌ Create patient error:', e);
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

        debug.log(`🔄 Updating patient ${identifier} (Type: ${isUuid ? 'ID' : 'Code'})`);

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

        const { data, error } = await supabase.from('patients').update(updates).eq('id', existing.id).select().single();
        if (error) throw error;

        debug.success(`✅ Patient ${existing.id} updated`);
        res.json({ success: true, message: 'Updated', patient: data });
    } catch (e) {
        debug.error('❌ Update patient error:', e);
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

// Update by code (Legacy support)
router.put('/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;

        debug.log(`🔄 Updating patient by code: ${patientCode}`);

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
        debug.error('❌ Update patient by code error:', e);
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
        const hasPermission = userRole === 'admin' || (accessibleIds && accessibleIds.includes(patient.user_id));

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
        const hasPermission = userRole === 'admin' || (accessibleIds && accessibleIds.includes(patient.user_id));

        if (!hasPermission) return res.status(403).json({ success: false, error: 'Permission denied' });

        await supabase.from('patients').delete().eq('id', patient.id);
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
