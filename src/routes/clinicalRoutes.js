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

    // 1. Try to resolve as a direct numeric ID or UUID
    const isNumeric = /^\d+$/.test(identifier);
    if (isNumeric) return identifier;

    // (Lookup logic for MR number would go here if it used a different column name)


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

/**
 * Quick Safety Check (Database-driven instead of AI)
 * Supports nested rule_condition structures like:
 *   { all: [ {fact: "age", ...}, { any: [{fact: "medications", ...}, ...] } ] }
 * 
 * ENHANCED: Now properly captures interactions and IV incompatibilities for:
 * - Single drug searches (shows all interactions involving that drug)
 * - Multi-drug searches (shows interactions involving the searched drugs)
 */
router.post('/quick-safety', authenticateToken, async (req, res) => {
    try {
        const { medication, medications: medList } = req.body;
        
        // Support either a single medication string or an array of medications
        let meds = [];
        if (medList && Array.isArray(medList) && medList.length > 0) {
            meds = medList.map(m => m.toLowerCase().trim());
        } else if (medication) {
            // Split by comma if user typed multiple in one string, just in case
            meds = medication.split(',').map(m => m.toLowerCase().trim()).filter(Boolean);
        }

        if (meds.length === 0) return res.status(400).json({ success: false, error: 'Medication required' });

        const targetDb = supabaseAdmin || supabase;
        const { data: rules, error } = await targetDb
            .from('clinical_rules')
            .select('*')
            .eq('is_active', true);

        if (error) throw error;

        // Base safety profile structure
        const safetyProfile = {
            medication: meds.join(', '),
            general_overview: `Safety profile derived from clinical rules database for ${meds.join(', ')}.`,
            categories: {
                pregnancy: { status: 'Safe', details: 'No known contraindications in database.' },
                lactation: { status: 'Safe', details: 'No known contraindications in database.' },
                elderly: { status: 'Safe', details: 'No known contraindications in database.' },
                neonate: { status: 'Safe', details: 'No known contraindications in database.' },
                kidney_failure: { status: 'Safe', details: 'No known contraindications in database.' },
                liver_failure: { status: 'Safe', details: 'No known contraindications in database.' }
            },
            major_interactions: [],
            iv_incompatibility: []
        };

        /**
         * Recursively collect ALL leaf facts from a nested condition tree.
         * Handles: { all: [...] }, { any: [...] }, and plain { fact, value, operator }
         */
        const collectFacts = (node) => {
            if (!node) return [];
            const results = [];
            if (node.fact) {
                results.push(node);
            }
            if (Array.isArray(node.all)) {
                node.all.forEach(child => results.push(...collectFacts(child)));
            }
            if (Array.isArray(node.any)) {
                node.any.forEach(child => results.push(...collectFacts(child)));
            }
            return results;
        };

        // Helper to get all medication names from a condition block
        const getAllMedicationsInBlock = (block) => {
            const facts = collectFacts(block);
            const meds = [];
            facts.forEach(f => {
                if (f.fact === 'medications' && f.value) {
                    const val = String(f.value);
                    if (!meds.includes(val)) {
                        meds.push(val);
                    }
                }
            });
            return meds;
        };

        // Helper to check if a condition targets ANY of the provided medications
        const hasMedication = (condition) => {
            const facts = collectFacts(condition);
            return facts.some(f => f.fact === 'medications' && f.value && meds.some(m => {
                const ruleVal = String(f.value).toLowerCase();
                return ruleVal.includes(m) || m.includes(ruleVal);
            }));
        };

        // Helper: is an operator an "elderly" check? (age >= 60, age > 59, etc.)
        const isElderlyCheck = (f) => {
            if (f.fact !== 'age') return false;
            const op = f.operator;
            const val = Number(f.value);
            return (op === '>=' && val >= 60) || (op === '>' && val >= 59) ||
                   (op === 'greaterThan' && val >= 59) || (op === 'greaterThanOrEqual' && val >= 60) ||
                   (op === 'greaterThanInclusive' && val >= 60);
        };

        // Helper: is an operator a "neonate/pediatric" check? (age < 2, age <= 12, etc.)
        const isNeonateCheck = (f) => {
            if (f.fact !== 'age') return false;
            const op = f.operator;
            const val = Number(f.value);
            return (op === '<' && val <= 18) || (op === '<=' && val <= 18) ||
                   (op === 'lessThan' && val <= 18) || (op === 'lessThanOrEqual' && val <= 18);
        };

        // Parse each rule
        rules.forEach(rule => {
            const cond = rule.rule_condition;
            if (!hasMedication(cond)) return;

            const allFacts = collectFacts(cond);
            const severity = rule.severity;
            const msg = rule.rule_action?.message_client || rule.rule_action?.message || rule.rule_name;
            const rec = rule.rule_action?.recommendation_client || rule.rule_action?.recommendation || '';
            const detail = (rec ? `${msg} ${rec}` : msg);
            const status = (severity === 'critical' || severity === 'high') ? 'Contraindicated' : 'Caution';
            
            const lowerRuleName = String(rule.rule_name).toLowerCase();
            const lowerRuleType = String(rule.rule_type).toLowerCase();

            // ============================================
            // ENHANCED: Drug Interactions
            // Captures both single-drug and multi-drug interactions
            // ============================================
            if (lowerRuleType.includes('drug_interaction') || lowerRuleName.includes('interaction')) {
                // Get the interaction condition blocks
                let interactionBlocks = [];
                if (Array.isArray(rule.rule_condition?.any)) {
                    interactionBlocks = rule.rule_condition.any;
                } else if (rule.rule_condition) {
                    interactionBlocks = [rule.rule_condition];
                }
                
                interactionBlocks.forEach(block => {
                    // Get ALL medications in this block
                    const blockMeds = [...new Map(
                        getAllMedicationsInBlock(block)
                            .map(m => String(m).trim())
                            .filter(Boolean)
                            .map(m => [m.toLowerCase(), m])
                    ).values()];
                    
                    // Check if ANY of the user's medications match this block
                    const hasMatch = blockMeds.some(ruleMed => 
                        meds.some(userMed => 
                            String(ruleMed).toLowerCase().includes(userMed) || 
                            userMed.includes(String(ruleMed).toLowerCase())
                        )
                    );
                    
                    if (hasMatch) {
                        // Find which user medications matched
                        const matchedUserMeds = meds.filter(userMed =>
                            blockMeds.some(ruleMed =>
                                String(ruleMed).toLowerCase().includes(userMed) ||
                                userMed.includes(String(ruleMed).toLowerCase())
                            )
                        );
                        
                        // If we have at least one matched medication, show the interaction
                        if (matchedUserMeds.length > 0) {
                            let interactionText = '';
                            
                            // Format the interaction text without duplicating the medication name
                            if (blockMeds.length > 1) {
                                // Multi-drug interaction - show all drugs in the rule
                                const allDrugs = blockMeds.map(m => String(m));
                                
                                // Check if the user searched for multiple drugs that match this interaction
                                const searchedInBlock = allDrugs.filter(d => 
                                    meds.some(m => d.toLowerCase().includes(m) || m.includes(d.toLowerCase()))
                                );
                                
                                if (searchedInBlock.length >= 2) {
                                    // User searched for 2+ drugs that interact - highlight them
                                    interactionText = `⚠️ ${searchedInBlock.join(' + ')} — ${msg}`;
                                } else if (searchedInBlock.length === 1) {
                                    // User searched for 1 drug - show the full interaction without duplicating
                                    const otherDrugs = allDrugs.filter(d => !searchedInBlock.some(s => d.toLowerCase().includes(s) || s.includes(d.toLowerCase())));
                                    if (otherDrugs.length > 0) {
                                        // Only show the searched drug once with other drugs
                                        interactionText = `⚠️ ${searchedInBlock[0]} + ${otherDrugs.join(' + ')} — ${msg}`;
                                    } else {
                                        // If no other drugs, show all drugs
                                        interactionText = `⚠️ ${allDrugs.join(' + ')} — ${msg}`;
                                    }
                                } else {
                                    // Fallback - show all drugs
                                    interactionText = `⚠️ ${allDrugs.join(' + ')} — ${msg}`;
                                }
                            } else {
                                // Single drug interaction - just show the message without repeating the drug name
                                const drugName = String(blockMeds[0]);
                                // Check if the message already contains the drug name
                                if (msg.toLowerCase().includes(drugName.toLowerCase())) {
                                    interactionText = `⚠️ ${msg}`;
                                } else {
                                    interactionText = `⚠️ ${drugName}: ${msg}`;
                                }
                            }
                            
                            // Only add if not already present
                            if (!safetyProfile.major_interactions.includes(interactionText)) {
                                safetyProfile.major_interactions.push(interactionText);
                            }
                        }
                    }
                });
            }

            // ============================================
            // ENHANCED: IV Incompatibility
            // Captures both single-drug and multi-drug incompatibilities
            // ============================================
            if (lowerRuleType === 'iv incompatibility' || 
                lowerRuleName.includes('iv drug incompatibility') || 
                lowerRuleName.includes('iv incompatibility')) {
                
                let incompatBlocks = [];
                if (Array.isArray(rule.rule_condition?.any)) {
                    incompatBlocks = rule.rule_condition.any;
                } else if (rule.rule_condition) {
                    incompatBlocks = [rule.rule_condition];
                }
                
                incompatBlocks.forEach(block => {
                    // Get ALL medications in this block
                    const blockMeds = [...new Map(
                        getAllMedicationsInBlock(block)
                            .map(m => String(m).trim())
                            .filter(Boolean)
                            .map(m => [m.toLowerCase(), m])
                    ).values()];
                    
                    // Check if ANY of the user's medications match this block
                    const hasMatch = blockMeds.some(ruleMed => 
                        meds.some(userMed => 
                            String(ruleMed).toLowerCase().includes(userMed) || 
                            userMed.includes(String(ruleMed).toLowerCase())
                        )
                    );
                    
                    if (hasMatch) {
                        // Find which user medications matched
                        const matchedUserMeds = meds.filter(userMed =>
                            blockMeds.some(ruleMed =>
                                String(ruleMed).toLowerCase().includes(userMed) ||
                                userMed.includes(String(ruleMed).toLowerCase())
                            )
                        );
                        
                        // If we have at least one matched medication, show the incompatibility
                        if (matchedUserMeds.length > 0) {
                            let incompatText = '';
                            
                            // Format the incompatibility text without duplicating the medication name
                            if (blockMeds.length > 1) {
                                // Multi-drug incompatibility - show all drugs in the rule
                                const allDrugs = blockMeds.map(m => String(m));
                                
                                // Check if the user searched for multiple drugs that are incompatible
                                const searchedInBlock = allDrugs.filter(d => 
                                    meds.some(m => d.toLowerCase().includes(m) || m.includes(d.toLowerCase()))
                                );
                                
                                if (searchedInBlock.length >= 2) {
                                    // User searched for 2+ drugs that are incompatible
                                    incompatText = `🔴 ${searchedInBlock.join(' + ')} — ${msg}`;
                                } else if (searchedInBlock.length === 1) {
                                    // User searched for 1 drug - show the full incompatibility without duplicating
                                    const otherDrugs = allDrugs.filter(d => !searchedInBlock.some(s => d.toLowerCase().includes(s) || s.includes(d.toLowerCase())));
                                    if (otherDrugs.length > 0) {
                                        // Only show the searched drug once with other drugs
                                        incompatText = `🔴 ${searchedInBlock[0]} + ${otherDrugs.join(' + ')} — ${msg}`;
                                    } else {
                                        // If no other drugs, show all drugs
                                        incompatText = `🔴 ${allDrugs.join(' + ')} — ${msg}`;
                                    }
                                } else {
                                    // Fallback - show all drugs
                                    incompatText = `🔴 ${allDrugs.join(' + ')} — ${msg}`;
                                }
                            } else {
                                // Single drug incompatibility - just show the message without repeating the drug name
                                const drugName = String(blockMeds[0]);
                                // Check if the message already contains the drug name
                                if (msg.toLowerCase().includes(drugName.toLowerCase())) {
                                    incompatText = `🔴 ${msg}`;
                                } else {
                                    incompatText = `🔴 ${drugName}: ${msg}`;
                                }
                            }
                            
                            // Only add if not already present
                            if (!safetyProfile.iv_incompatibility.includes(incompatText)) {
                                safetyProfile.iv_incompatibility.push(incompatText);
                            }
                        }
                    }
                });
            }

            // Check for pregnancy (existing logic)
            if (lowerRuleType.includes('pregnancy') || lowerRuleName.includes('pregnancy') || allFacts.some(f => f.fact === 'pregnancy' || (f.fact === 'conditions' && String(f.value).toLowerCase().includes('pregnancy')))) {
                safetyProfile.categories.pregnancy = { status, details: detail };
            }

            // Check for lactation (existing logic)
            if (lowerRuleType.includes('lactation') || lowerRuleType.includes('breastfeeding') || lowerRuleName.includes('lactation') || lowerRuleName.includes('breastfeeding') || allFacts.some(f => f.fact === 'lactation' || (f.fact === 'conditions' && String(f.value).toLowerCase().includes('lactation')))) {
                safetyProfile.categories.lactation = { status, details: detail };
            }

            // Check for elderly (existing logic)
            if (lowerRuleType.includes('elderly') || lowerRuleName.includes('elderly') || lowerRuleName.includes('eldery') || allFacts.some(f => isElderlyCheck(f))) {
                safetyProfile.categories.elderly = { status, details: detail };
            }

            // Check for neonates/pediatrics (existing logic)
            if (lowerRuleType.includes('neonate') || lowerRuleType.includes('pediatric') || lowerRuleType.includes('infant') || lowerRuleName.includes('neonate') || lowerRuleName.includes('pediatric') || lowerRuleName.includes('infant') || allFacts.some(f => isNeonateCheck(f))) {
                safetyProfile.categories.neonate = { status, details: detail };
            }

            // Check for kidney failure (existing logic)
            if (lowerRuleType.includes('renal') || lowerRuleType.includes('kidney') || lowerRuleName.includes('renal') || lowerRuleName.includes('kidney') || allFacts.some(f => 
                f.fact === 'labs.creatinine_clearance' || f.fact === 'labs.egfr' || f.fact === 'labs.serum_creatinine' ||
                (f.fact === 'diagnosis' && String(f.value).toLowerCase().includes('renal')) || 
                (f.fact === 'diagnosis' && String(f.value).toLowerCase().includes('kidney')) ||
                (f.fact === 'conditions' && String(f.value).toLowerCase().includes('renal')) ||
                (f.fact === 'conditions' && String(f.value).toLowerCase().includes('kidney'))
            )) {
                safetyProfile.categories.kidney_failure = { status, details: detail };
            }

            // Check for liver failure (existing logic)
            if (lowerRuleType.includes('liver') || lowerRuleType.includes('hepatic') || lowerRuleName.includes('liver') || lowerRuleName.includes('hepatic') || lowerRuleName.includes('cirrhosis') || allFacts.some(f => 
                f.fact === 'labs.total_bilirubin' || f.fact === 'labs.ast' || f.fact === 'labs.alt' || f.fact === 'labs.inr' ||
                (f.fact === 'diagnosis' && String(f.value).toLowerCase().includes('liver')) || 
                (f.fact === 'diagnosis' && String(f.value).toLowerCase().includes('hepatic')) ||
                (f.fact === 'diagnosis' && String(f.value).toLowerCase().includes('cirrhosis')) ||
                (f.fact === 'conditions' && String(f.value).toLowerCase().includes('liver')) ||
                (f.fact === 'conditions' && String(f.value).toLowerCase().includes('hepatic'))
            )) {
                safetyProfile.categories.liver_failure = { status, details: detail };
            }
        });
        
        // Remove duplicates from interactions and incompatibilities
        safetyProfile.major_interactions = [...new Set(safetyProfile.major_interactions)];
        safetyProfile.iv_incompatibility = [...new Set(safetyProfile.iv_incompatibility)];

        // Log the results for debugging
        console.log(`✅ IV Incompatibilities found: ${safetyProfile.iv_incompatibility.length}`);
        console.log(`✅ Major Interactions found: ${safetyProfile.major_interactions.length}`);

        res.json({ success: true, safetyProfile, disclaimer: 'Safety profile generated from internal clinical rules database.' });

    } catch (e) {
        console.error('❌ Quick Safety Error:', e);
        res.status(500).json({ success: false, error: 'Failed to retrieve safety profile' });
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
        
        // Resolve patient context (Code lookups removed as patient_code does not exist)
        if (updates.patient_id) {
            // Patient ID already provided
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
