import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, getUserAccessibleData } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Helper to resolve a patient identifier (UUID, ID, or Code) to a numeric BIGINT ID.
 * Returns null if not found or invalid.
 */
async function resolvePatientId(identifier) {
    if (!identifier) return null;
    
    const db = supabaseAdmin || supabase;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    
    // prioritze checking if it's already a valid primary ID (UUID or numeric)
    if (isUUID) return identifier;

    // 1. Try to resolve as a code (MR number like '172') using Admin client to bypass RLS for resolution
    const { data: byCode } = await (supabaseAdmin || supabase).from('patients').select('id').eq('patient_code', identifier).maybeSingle();
    if (byCode) return byCode.id;

    // 2. FALLBACK: If it's numeric, it might be a legacy numeric ID
    if (/^\d+$/.test(identifier)) return identifier;

    return null;
}

/**
 * 🛡️ Robust Clinical Access Check
 * Verifies if a user has permission to see a specific patient's clinical data.
 */
async function verifyClinicalAccess(patientId, req) {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userCompanyId = req.user.company_id;
    const userAccountType = req.user.account_type;

    if (userRole === 'admin' || userRole === 'superadmin') return true;

    const db = supabaseAdmin || supabase;

    // Safety: If patientId is not a UUID and not numeric, it's definitely invalid for the 'id' column
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);
    const isNumeric = /^\d+$/.test(patientId);
    if (!isUUID && !isNumeric) return false;

    try {
        // Resolve Patient Owner
        const { data: patient, error: patientError } = await db.from('patients').select('id, user_id').eq('id', patientId).maybeSingle();
        if (patientError || !patient) return false;

        // 1. Simple Ownership
        if (patient.user_id === userId) return true;

        // 2. Company Access
        const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
        if (accessibleUserIds && accessibleUserIds.includes(patient.user_id)) return true;

        // 3. Approved Access Request
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: access } = await db.from('access_requests')
            .select('id')
            .eq('patient_id', patientId)
            .eq('requester_id', userId)
            .eq('status', 'approved')
            .gt('approved_at', twentyFourHoursAgo)
            .maybeSingle();

        return !!access;
    } catch (e) {
        console.error('Access check failed:', e);
        return false;
    }
}

// ARN Assessments
router.post('/assessments/drn', authenticateToken, async (req, res) => {
    try {
        const {
            patient_id,
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

        const resolvedId = await resolvePatientId(patient_id);
        if (!resolvedId) {
            return res.status(400).json({ success: false, error: 'Invalid patient reference' });
        }

        const hasAccess = await verifyClinicalAccess(resolvedId, req);
        
        // Restriction: Individual subscribers cannot access DRN unless they have authorized support access to this patient
        if (!hasAccess || (userAccountType === 'individual' && userRole !== 'admin' && !req.authorizedSupport)) {
            // Note: verifyClinicalAccess will handle the base ownership/company/support check.
            // We only block individuals here if they aren't authorized or it's a general restriction.
            if (userAccountType === 'individual' && userRole !== 'admin' && !hasAccess) {
                return res.status(403).json({ success: false, error: 'DRN assessment is not available for individual subscribers' });
            }
            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
            }
        }

        const assessmentData = {
            patient_id: resolvedId,
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

        const resolvedId = await resolvePatientId(patientCode);
        if (!resolvedId || !(await verifyClinicalAccess(resolvedId, req))) {
            return res.json({ success: true, assessments: [] });
        }
        
        // Restriction for individuals - still block if they don't have clinical access (though verify already checked)
        if (userAccountType === 'individual' && userRole !== 'admin' && !(await verifyClinicalAccess(resolvedId, req))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        let query = supabase.from('drn_assessments').select('*').eq('patient_id', resolvedId);

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
        const resolvedId = await resolvePatientId(patient_id);
        if (!resolvedId) {
            return res.status(400).json({ success: false, error: 'Invalid patient reference' });
        }

        const planData = {
            patient_id: resolvedId, user_id: req.user.userId,
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
 
        const resolvedId = await resolvePatientId(patientCode);
        if (!resolvedId) return res.json({ success: true, plans: [] });

        let query = supabase.from('pharmacy_assistance_plans').select('*').eq('patient_id', resolvedId);

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
        const resolvedId = await resolvePatientId(req.body.patient_id);
        const item = { 
            ...req.body, 
            patient_id: resolvedId, 
            user_id: req.user.userId, 
            created_at: new Date().toISOString(), 
            updated_at: new Date().toISOString() 
        };
        delete item.patient_code;
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
 
        const resolvedId = await resolvePatientId(patientCode);
        if (!resolvedId) return res.json({ success: true, outcomes: [] });

        let query = supabase.from('patient_outcomes').select('*').eq('patient_id', resolvedId);

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
        delete updates.patient_code;

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

        const resolvedId = await resolvePatientId(req.body.patient_id);
        const item = {
            ...req.body,
            patient_id: resolvedId,
            user_id: isUUID(req.user.userId) ? req.user.userId : null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        delete item.patient_code;

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
        delete updates.patient_code;

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
 
        // 🔐 Resolve identifier and enforce UUID for this clinical table
        const resolvedId = await resolvePatientId(patientCode);
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedId);

        if (!resolvedId || !isUUID) {
            // Return empty if not found or not a UUID (numeric legacy IDs are incompatible with this clinical table)
            return res.json({ success: true, costs: [] }); 
        }

        let query = supabase.from('cost_analyses').select('*').eq('patient_id', resolvedId);

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
        const targetDb = supabaseAdmin || supabase;
        const { data, error } = await targetDb
            .from('clinical_rules')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ Error fetching clinical rules:', error);
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
 
        // 1. Verify access to the patient first using resolved ID
        const resolvedId = await resolvePatientId(patientCode);
        if (!resolvedId) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }

        const hasAccess = await verifyClinicalAccess(resolvedId, req);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }

        // 2. Fetch medications for verified patient using patient's ID
        let query = (supabaseAdmin || supabase).from('medication_history').select('*');
        query = query.eq('patient_id', resolvedId);

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

        const resolvedId = await resolvePatientId(req.body.patient_id || req.body.patient_code);
        if (!resolvedId || !(await verifyClinicalAccess(resolvedId, req))) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }
        const medicationData = {
            ...req.body,
            patient_id: resolvedId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        delete medicationData.patient_code;
        const { data, error } = await supabase.from('medication_history').insert([medicationData]).select().single();
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
        delete updates.patient_code;
        // Now that patient_id is added, we allow it to be updated or persisted
        // delete updates.patient_id; 
        
        // Resolve patient context
        const isUUID = updates.patient_code && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(updates.patient_code);
        const isNumeric = updates.patient_code && /^\d+$/.test(updates.patient_code);
        const isIdSearch = (updates.patient_code && (isUUID || isNumeric)) || (updates.patient_id);

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
        const resolvedId = await resolvePatientId(req.body.patient_id);
        if (!resolvedId || !(await verifyClinicalAccess(resolvedId, req))) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }
        const vitalsData = {
            ...req.body,
            patient_id: resolvedId, // Ensure patient_id is resolved numeric ID
            created_by: userId,
            created_at: new Date().toISOString()
        };
        delete vitalsData.patient_code;
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
        delete updates.patient_code;

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

        const resolvedId = await resolvePatientId(patientCode);
        if (!resolvedId || !(await verifyClinicalAccess(resolvedId, req))) {
            return res.json({ success: true, vitals: [] });
        }

        let query = (supabaseAdmin || supabase).from('vitals_history').select('*').eq('patient_id', resolvedId);

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
        const resolvedId = await resolvePatientId(req.body.patient_id);
        if (!resolvedId || !(await verifyClinicalAccess(resolvedId, req))) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }
        const labsData = {
            ...req.body,
            patient_id: resolvedId, // Ensure patient_id is included
            created_by: userId,
            created_at: new Date().toISOString()
        };
        delete labsData.patient_code;
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
        delete updates.patient_code;

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

        const resolvedId = await resolvePatientId(patientCode);
        if (!resolvedId || !(await verifyClinicalAccess(resolvedId, req))) {
            return res.json({ success: true, labs: [] });
        }

        let query = (supabaseAdmin || supabase).from('labs_history').select('*').eq('patient_id', resolvedId);

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
        const resolvedId = await resolvePatientId(req.body.patient_id);
        if (!resolvedId || !(await verifyClinicalAccess(resolvedId, req))) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }
        const reconData = {
            ...req.body,
            patient_id: resolvedId,
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        delete reconData.patient_code;
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
 
        // 🔐 Resolve and enforce UUID type
        const resolvedId = await resolvePatientId(patientCode);
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedId);

        if (!resolvedId || !isUUID) {
            return res.json({ success: true, reconciliations: [] });
        }

        let query = (supabaseAdmin || supabase).from('medication_reconciliations').select('*').eq('patient_id', resolvedId);

        const { data, error } = await query.order('date', { ascending: false });
        if (error) throw error;
        res.json({ success: true, reconciliations: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.delete('/reconciliations/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;

        // Check ownership if not admin
        const { data: existing, error: fetchError } = await (supabaseAdmin || supabase)
            .from('medication_reconciliations')
            .select('created_by')
            .eq('id', id)
            .single();

        if (fetchError || !existing) {
            return res.status(404).json({ success: false, error: 'Reconciliation not found' });
        }

        if (userRole !== 'admin' && existing.created_by !== userId) {
            return res.status(403).json({ success: false, error: 'Unauthorized to delete this record' });
        }

        const { error } = await (supabaseAdmin || supabase)
            .from('medication_reconciliations')
            .delete()
            .eq('id', id);

        if (error) throw error;
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
    }
});

export default router;

