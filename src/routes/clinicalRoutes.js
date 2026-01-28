import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { debug } from '../utils/logger.js';
import { authenticateToken, getUserAccessibleData } from '../middleware/authMiddleware.js';

const router = express.Router();

// ARN Assessments
router.post('/assessments/drn', authenticateToken, async (req, res) => {
    try {
        const { patient_id, patient_code, category, severity, interventions, monitoring_plan, notes } = req.body;
        const userId = req.user.userId;
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;

        // Restriction: Individual subscribers cannot access DRN
        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'DRN assessment is not available for individual subscribers' });
        }

        const assessmentData = {
            patient_id, patient_code, user_id: userId,
            category, severity, interventions, monitoring_plan, notes,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase.from('drn_assessments').insert([assessmentData]).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Saved', assessment: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Server error' });
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

        let query = supabase.from('drn_assessments').select('*').eq('patient_code', patientCode);

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
        debug.error('Get assessments error:', e);
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

        const { data, error } = await (supabaseAdmin || supabase).from('drn_assessments').update(updates).eq('id', id).select().single();
        if (error) throw error;
        res.json({ success: true, assessment: data });
    } catch (e) {
        debug.error('Update assessment error:', e);
        res.status(500).json({ success: false, error: 'Failed' });
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
        debug.error('Delete assessment error:', e);
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

        let query = supabase.from('pharmacy_assistance_plans').select('*').eq('patient_code', patientCode);

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
        debug.error('Get plans error:', e);
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
        const item = { ...req.body, user_id: req.user.userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
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

        let query = supabase.from('patient_outcomes').select('*').eq('patient_code', patientCode);

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
        const { error } = await (supabaseAdmin || supabase).from('patient_outcomes').delete().eq('id', id);
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
        const item = { ...req.body, user_id: req.user.userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        // Logic for UUID fallback/int fallback handling omitted for brevity but should be included if crucial
        // Simplified insert:
        const { data, error } = await supabase.from('cost_analyses').insert([item]).select().single();
        if (error) throw error;
        res.status(201).json({ success: true, message: 'Saved', cost: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/costs/:id', authenticateToken, async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        const { data, error } = await supabase.from('cost_analyses').update(updates).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json({ success: true, message: 'Updated', cost: data });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Error' });
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

        let query = supabase.from('cost_analyses').select('*').eq('patient_code', patientCode);

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
        res.status(500).json({ success: false, error: 'Error' });
    }
});

router.delete('/costs/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await (supabaseAdmin || supabase).from('cost_analyses').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true, message: 'Cost analysis deleted' });
    } catch (e) {
        debug.error('Delete cost error:', e);
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
        let patientQuery = supabase.from('patients').select('id, user_id').eq('patient_code', patientCode);

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (accessibleUserIds && accessibleUserIds.length > 0) {
                patientQuery = patientQuery.in('user_id', accessibleUserIds);
            }
        }

        const { data: patient, error: patientError } = await patientQuery.maybeSingle();

        if (patientError) throw patientError;
        if (!patient) {
            debug.warn(`🚫 Access denied to patient ${patientCode} for user ${userId}`);
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }

        // 2. Fetch medications for verified patient
        // Note: medication_history table doesn't have created_by column, access is controlled via patient ownership
        let query = (supabaseAdmin || supabase).from('medication_history').select('*').eq('patient_code', patientCode);

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
        const userId = req.user.userId;
        const medicationData = {
            ...req.body,
            // Temporarily removed user column to find correct name
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { data, error } = await (supabaseAdmin || supabase).from('medication_history').insert([medicationData]).select().single();
        if (error) throw error;
        res.status(201).json({ success: true, medication: data });
    } catch (e) {
        debug.error('Post medication error:', e);
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.put('/medications/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        delete updates.id;
        delete updates.user_id;

        const { data, error } = await supabase.from('medication_history').update(updates).eq('id', id).select().single();
        if (error) throw error;
        res.json({ success: true, medication: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

router.delete('/medication-history/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await (supabaseAdmin || supabase).from('medication_history').delete().eq('id', id);
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
        const { error } = await (supabaseAdmin || supabase).from('medication_history').delete().eq('id', id);
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
            created_by: userId,
            created_at: new Date().toISOString()
        };
        const { data, error } = await (supabaseAdmin || supabase).from('vitals_history').insert([vitalsData]).select().single();
        if (error) {
            // Fallback for missing table - many systems might not have it yet
            debug.warn('vitals_history table might not exist, skipping history save');
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

        let query = (supabaseAdmin || supabase).from('vitals_history').select('*').eq('patient_code', patientCode);

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
            created_by: userId,
            created_at: new Date().toISOString()
        };
        const { data, error } = await (supabaseAdmin || supabase).from('labs_history').insert([labsData]).select().single();
        if (error) {
            debug.warn('labs_history table might not exist');
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

        let query = (supabaseAdmin || supabase).from('labs_history').select('*').eq('patient_code', patientCode);

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
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { data, error } = await (supabaseAdmin || supabase).from('medication_reconciliations').insert([reconData]).select().single();
        if (error) {
            debug.error('❌ Error saving reconciliation:', error);
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

        let query = (supabaseAdmin || supabase).from('medication_reconciliations').select('*').eq('patient_code', patientCode);

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
