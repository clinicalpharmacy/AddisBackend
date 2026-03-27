import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, getUserAccessibleData } from '../middleware/authMiddleware.js';

const router = express.Router();

// ARN Assessments
router.post('/assessments/drn', authenticateToken, async (req, res) => {
    try {
        const {
            patient_id,
            patient_code,
            drn_assessment_activity_category,
            cause,
            dtp_type,
            specific_case,
            medical_condition,
            medication,
            drn,
        } = req.body;

        const userId = req.user.userId;
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access DRN
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'DRN assessment is not available for individual subscribers' });
        }

        const assessmentData = {
            patient_id,
            patient_code,
            user_id: userId,
            drn_assessment_activity_category,
            cause,
            dtp_type,
            specific_case,
            medical_condition,
            medication,
            drn,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase.from('drn_assessments').insert([assessmentData]).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Saved', assessment: data });
    } catch (e) {
        console.error('Error saving assessment:', e);
        res.status(500).json({ success: false, error: e.message || 'Server error', details: e });
    }
});

router.get('/assessments/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type;

        // Restriction: Individual subscribers cannot access DRN
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientCode);
        let query = supabase.from('drn_assessments').select('*');
        if (isUUID) {
            query = query.eq('patient_id', patientCode);
        } else {
            query = query.eq('patient_code', patientCode);
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds) {
                query = query.in('user_id', accessibleUserIds);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, assessments: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to fetch assessments' });
    }
});

router.put('/assessments/drn/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access DRN
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        delete updates.user_id;
        delete updates.patient_id;
        delete updates.patient_code;

        const { data, error } = await (supabaseAdmin || supabase)
            .from('drn_assessments')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ success: true, assessment: data });
    } catch (e) {
        console.error('Error updating assessment:', e);
        res.status(500).json({ success: false, error: 'Failed to update assessment' });
    }
});

router.delete('/assessments/drn/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access DRN
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const { error } = await (supabaseAdmin || supabase).from('drn_assessments').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Assessment deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Pharmacy Plans
router.post('/plans/pharmacy-assistance', authenticateToken, async (req, res) => {
    try {
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access PharmAssist Plans
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied for individual subscribers' });
        }
        const { patient_id, patient_code, plan_type, goals, medications, monitoring, follow_up, notes } = req.body;
        const planData = {
            patient_id, patient_code, user_id: req.user.userId,
            plan_type, goals, medications, monitoring, follow_up, notes,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase.from('pharmacy_assistance_plans').insert([planData]).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Saved', plan: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

router.get('/plans/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access PharmAssist Plans
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const userId = req.user.userId;
        const userCompanyId = req.user.company_id;
 
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientCode);
        let query = supabase.from('pharmacy_assistance_plans').select('*');
        if (isUUID) {
            query = query.eq('patient_id', patientCode);
        } else {
            query = query.eq('patient_code', patientCode);
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds) {
                query = query.in('user_id', accessibleUserIds);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, plans: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.delete('/plans/:planId', authenticateToken, async (req, res) => {
    try {
        const { planId } = req.params;
        const { data: plan } = await supabase.from('pharmacy_assistance_plans').select('user_id').eq('id', planId).single();
        if (!plan) return res.status(404).json({ error: 'Not found' });

        if (req.user.role !== 'admin' && plan.user_id !== req.user.userId) return res.status(403).json({ error: 'Denied' });

        await supabase.from('pharmacy_assistance_plans').delete().eq('id', planId);
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

// Outcomes
router.post('/outcomes', authenticateToken, async (req, res) => {
    try {
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access Outcomes
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied for individual subscribers' });
        }
        const item = { ...req.body, patient_id: req.body.patient_id || null, user_id: req.user.userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        const { data, error } = await supabase.from('patient_outcomes').insert([item]).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Saved', outcome: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

router.get('/outcomes/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access Outcomes
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const userId = req.user.userId;
        const userCompanyId = req.user.company_id;
 
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientCode);
        let query = supabase.from('patient_outcomes').select('*');
        if (isUUID) {
            query = query.eq('patient_id', patientCode);
        } else {
            query = query.eq('patient_code', patientCode);
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds) {
                query = query.in('user_id', accessibleUserIds);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, outcomes: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error' });
    }
});

router.put('/outcomes/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        delete updates.user_id;

        const { data, error } = await (supabaseAdmin || supabase).from('patient_outcomes').update(updates).eq('id', id).select().single();
        if (error) throw error;
        res.json({ success: true, outcome: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.delete('/outcomes/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const db = supabaseAdmin || supabase;
        const { error } = await db.from('patient_outcomes').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Outcome deleted' });
    } catch (e) {
        console.error('❌ Error deleting outcome:', e);
        res.status(500).json({ success: false, error: e.message || 'Failed to delete outcome' });
    }
});

// Costs
router.post('/costs', authenticateToken, async (req, res) => {
    try {
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access Cost Analysis
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied for individual subscribers' });
        }
        // UUID format check
        const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

        const item = {
            ...req.body,
            patient_id: req.body.patient_id || null,
            user_id: isUUID(req.user.userId) ? req.user.userId : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const targetDb = supabaseAdmin || supabase;
        const { data, error } = await targetDb.from('cost_analyses').insert([item]).select();

        if (error) throw error;

        if (!data || data.length === 0) {
            throw new Error('Failed to save cost analysis - no data returned');
        }

        res.status(201).json({ success: true, message: 'Saved', cost: data[0] });
    } catch (e) {
        console.error('Error saving cost analysis:', e);
        res.status(500).json({ success: false, error: e.message || 'Internal server error' });
    }
});

router.put('/costs/:id', authenticateToken, async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;

        const targetDb = supabaseAdmin || supabase;
        const { data, error } = await targetDb.from('cost_analyses').update(updates).eq('id', req.params.id).select();

        if (error) throw error;

        if (!data || data.length === 0) {
            throw new Error('Cost analysis not found or update failed');
        }

        res.json({ success: true, message: 'Updated', cost: data[0] });
    } catch (e) {
        console.error('Error updating cost analysis:', e);
        res.status(500).json({ success: false, error: e.message || 'Internal server error' });
    }
});

router.get('/costs/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access Cost Analysis
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const userId = req.user.userId;
        const userCompanyId = req.user.company_id;
 
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientCode);
        let query = supabase.from('cost_analyses').select('*');
        if (isUUID) {
            query = query.eq('patient_id', patientCode);
        } else {
            query = query.eq('patient_code', patientCode);
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds) {
                query = query.in('user_id', accessibleUserIds);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ success: true, costs: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/costs/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await (supabaseAdmin || supabase).from('cost_analyses').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Cost analysis deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Clinical Rules
router.get('/clinical-rules', authenticateToken, async (req, res) => {
    try {
        if (!supabaseAdmin) {
            console.error('❌ supabaseAdmin not configured');
            return res.status(503).json({ success: false, error: 'Database service unavailable' });
        }

        const { data, error } = await supabaseAdmin
            .from('clinical_rules')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ Error fetching clinical rules from Supabase:', error);
            throw error;
        }

        res.json({ success: true, rules: data || [] });
    } catch (e) {
        console.error('❌ Route error for /clinical-rules:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch clinical rules' });
    }
});



// Patient Medications for CDSS / History
router.get('/medication-history/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type;
 
        // 1. Verify access to the patient first
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientCode);
        const isNumeric = /^\d+$/.test(patientCode);
        const isIdSearch = isUUID || isNumeric;

        // Use admin client to avoid RLS blocking the lookup
        const db = supabaseAdmin || supabase;
        let patientQuery = db.from('patients').select('id, user_id, patient_code');
        patientQuery = isIdSearch
            ? patientQuery.eq('id', patientCode)
            : patientQuery.eq('patient_code', patientCode);

        const { data: patient, error: patientError } = await patientQuery.maybeSingle();

        if (patientError) throw patientError;
        if (!patient) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }

        // Manual access check
        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds && accessibleUserIds.length > 0 && !accessibleUserIds.includes(patient.user_id)) {
                return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
            }
        }

        // 2. Fetch medications for verified patient using patient's actual patient_code
        let query = db.from('medication_history').select('*');
        // Always query by resolved patient.patient_code for reliability because medication_history lacks patient_id
        query = query.eq('patient_code', patient.patient_code);

        const { data, error } = await query.order('start_date', { ascending: false });
        if (error) throw error;

        res.json({ success: true, medications: data || [] });
    } catch (e) {
        console.error('❌ Error fetching patient medications:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch medications' });
    }
});

// Patient Medications CRUD
router.post('/medication-history', authenticateToken, async (req, res) => {
    try {
        const { drug_name, start_date, dose, frequency, roa } = req.body;

        if (!drug_name || !start_date || !dose || !frequency || !roa) {
            return res.status(400).json({
                success: false,
                error: 'Required fields missing: drug_name, start_date, dose, frequency, and roa are mandatory'
            });
        }

        const db = supabaseAdmin || supabase;
        let pCode = req.body.patient_code;
        
        // Resolve patient_code if an ID (UUID or Numeric) is provided instead
        const isUUID = pCode && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pCode);
        const isNumeric = pCode && /^\d+$/.test(pCode);
        
        if (pCode && (isUUID || isNumeric)) {
            const { data: patient } = await db.from('patients').select('patient_code').eq('id', pCode).maybeSingle();
            if (patient && patient.patient_code) {
                pCode = patient.patient_code;
            }
        }

        const medicationData = {
            ...req.body,
            patient_code: pCode,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { data, error } = await db.from('medication_history').insert([medicationData]).select().single();
        if (error) throw error;
        res.status(201).json({ success: true, medication: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.put('/medications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { dose, frequency, roa } = req.body;

        if (dose === '' || frequency === '' || roa === '') {
            return res.status(400).json({
                success: false,
                error: 'Dose, frequency, and roa cannot be empty'
            });
        }

        const db = supabaseAdmin || supabase;
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        delete updates.user_id;
        delete updates.patient_id; // medication_history lacks patient_id column
        
        // Resolve patient_code if it looks like an ID
        const isUUID = updates.patient_code && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(updates.patient_code);
        const isNumeric = updates.patient_code && /^\d+$/.test(updates.patient_code);

        if (updates.patient_code && (isUUID || isNumeric)) {
            const { data: patient } = await db.from('patients').select('patient_code').eq('id', updates.patient_code).maybeSingle();
            if (patient && patient.patient_code) {
                updates.patient_code = patient.patient_code;
            }
        }

        const { data, error } = await (supabaseAdmin || supabase).from('medication_history').update(updates).eq('id', id).select().single();
        if (error) throw error;
        res.json({ success: true, medication: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.delete('/medication-history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const db = supabaseAdmin || supabase;
        const { error } = await db.from('medication_history').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

// Alias for medication deletion to match PUT route
router.delete('/medications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const db = supabaseAdmin || supabase;
        const { error } = await db.from('medication_history').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

// Vitals History
router.post('/vitals', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const vitalsData = {
            ...req.body,
            patient_id: req.body.patient_id || null, // Ensure patient_id is included
            created_by: userId,
            created_at: new Date().toISOString()
        };
        const { data, error } = await (supabaseAdmin || supabase).from('vitals_history').insert([vitalsData]).select().single();
        if (error) {
            // Fallback for missing table - many systems might not have it yet
            return res.status(200).json({ success: true, skipped: true, message: 'Saved to patient record only' });
        }
        res.json({ success: true, vitals: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.put('/vitals/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        delete updates.user_id; // Prevent user_id from being updated

        const { data, error } = await (supabaseAdmin || supabase).from('vitals_history').update(updates).eq('id', id).select().single();
        if (error) throw error;
        res.json({ success: true, vitals: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to update vitals' });
    }
});

router.delete('/vitals/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await (supabaseAdmin || supabase).from('vitals_history').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Vitals deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to delete vitals' });
    }
});

router.get('/vitals/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type;

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientCode);
        let query = (supabaseAdmin || supabase).from('vitals_history').select('*');
        if (isUUID) {
            query = query.eq('patient_id', patientCode);
        } else {
            query = query.eq('patient_code', patientCode);
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds) {
                query = query.in('created_by', accessibleUserIds);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (data && data.length > 0) {
            console.log('📋 Existing vitals_history record keys:', Object.keys(data[0]));
        }
        if (error) return res.json({ success: true, vitals: [] });
        res.json({ success: true, vitals: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Labs History
router.post('/labs-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const labsData = {
            ...req.body,
            patient_id: req.body.patient_id || null, // Ensure patient_id is included
            created_by: userId,
            created_at: new Date().toISOString()
        };
        const { data, error } = await (supabaseAdmin || supabase).from('labs_history').insert([labsData]).select().single();
        if (error) {
            return res.status(200).json({ success: true, skipped: true });
        }
        res.json({ success: true, labs: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.put('/labs-history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        delete updates.user_id; // Prevent user_id from being updated

        const { data, error } = await (supabaseAdmin || supabase).from('labs_history').update(updates).eq('id', id).select().single();
        if (error) throw error;
        res.json({ success: true, labs: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to update labs history' });
    }
});

router.delete('/labs-history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await (supabaseAdmin || supabase).from('labs_history').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Labs history entry deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to delete labs history entry' });
    }
});

router.get('/labs-history/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type;

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientCode);
        let query = (supabaseAdmin || supabase).from('labs_history').select('*');
        if (isUUID) {
            query = query.eq('patient_id', patientCode);
        } else {
            query = query.eq('patient_code', patientCode);
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType)
            if (accessibleUserIds) {
                query = query.in('created_by', accessibleUserIds);
            }
        }

        const { data, error } = await query.order('created_at', { ascending: false });
        if (data && data.length > 0) {
            console.log('📋 Existing labs_history record keys:', Object.keys(data[0]));
        }
        if (error) return res.json({ success: true, labs: [] });
        res.json({ success: true, labs: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Medication Reconciliation
router.post('/reconciliations', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const reconData = {
            ...req.body,
            patient_id: req.body.patient_id || null,
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { data, error } = await (supabaseAdmin || supabase).from('medication_reconciliations').insert([reconData]).select().single();
        if (error) {
            throw error;
        }
        res.status(201).json({ success: true, reconciliation: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.get('/reconciliations/patient/:patientCode', authenticateToken, async (req, res) => {
    try {
        const { patientCode } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type;
 
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(patientCode);
        let query = (supabaseAdmin || supabase).from('medication_reconciliations').select('*');
        if (isUUID) {
            query = query.eq('patient_id', patientCode);
        } else {
            query = query.eq('patient_code', patientCode);
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds) {
                query = query.in('created_by', accessibleUserIds);
            }
        }

        const { data, error } = await query.order('date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, reconciliations: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

export default router;
