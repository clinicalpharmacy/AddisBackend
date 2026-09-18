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

    if (isUUID) return identifier;

    const isNumeric = /^\d+$/.test(identifier);
    if (isNumeric) return identifier;

    if (/^\d+$/.test(identifier)) return identifier;

    return null;
}

/**
 * 🛡️ Robust Clinical Access Check
 */
async function verifyClinicalAccess(patientId, req) {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userCompanyId = req.user.company_id;
    const userAccountType = req.user.account_type;

    if (userRole === 'admin' || userRole === 'superadmin') return true;

    const db = supabaseAdmin || supabase;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);
    const isNumeric = /^\d+$/.test(patientId);
    if (!isUUID && !isNumeric) return false;

    try {
        const { data: patient, error: patientError } = await db.from('patients').select('id, user_id').eq('id', patientId).maybeSingle();
        if (patientError || !patient) return false;

        if (patient.user_id === userId) return true;

        const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
        if (accessibleUserIds && accessibleUserIds.includes(patient.user_id)) return true;

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

        if (!hasAccess || (userAccountType === 'individual' && userRole !== 'admin' && !req.authorizedSupport)) {
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

        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied for individual subscribers' });
        }
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

        if (userAccountType === 'individual' && userRole !== 'admin') {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const userId = req.user.userId;
        const userCompanyId = req.user.company_id;

        const resolvedId = await resolvePatientId(patientCode);
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedId);

        if (!resolvedId || !isUUID) {
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
 *
 * Supports nested rule_condition structures like:
 *   { all: [ {fact: "age", ...}, { any: [{fact: "medications", ...}, ...] } ] }
 *
 * Interaction & IV-incompatibility behaviour (revised):
 *  - ONLY pairs where BOTH sides are present in the user's search are emitted.
 *    This is the "combination check" behaviour — the endpoint reports the
 *    interactions that actually exist between the drugs the user entered.
 *  - A rule whose declared pair has only one side in the search is skipped
 *    (no fabricated partner is emitted).
 *  - Category messages (pregnancy, lactation, etc.) keep the existing
 *    `[<searched meds>] <message>` format.
 */
router.post('/quick-safety', authenticateToken, async (req, res) => {
    try {
        const { medication, medications: medList } = req.body;

        let meds = [];
        if (medList && Array.isArray(medList) && medList.length > 0) {
            meds = medList.map(m => m.toLowerCase().trim());
        } else if (medication) {
            meds = medication.split(',').map(m => m.toLowerCase().trim()).filter(Boolean);
        }

        if (meds.length === 0) {
            return res.status(400).json({ success: false, error: 'Medication required' });
        }

        const targetDb = supabaseAdmin || supabase;
        const { data: rules, error } = await targetDb
            .from('clinical_rules')
            .select('*')
            .eq('is_active', true);

        if (error) throw error;

        const safetyProfile = {
            medication: meds.join(', '),
            general_overview: `Safety profile derived from clinical rules database for ${meds.join(', ')}.`,
            categories: {
                pregnancy:      { status: 'Safe', details: 'No known contraindications in database.', medications: [] },
                lactation:      { status: 'Safe', details: 'No known contraindications in database.', medications: [] },
                elderly:        { status: 'Safe', details: 'No known contraindications in database.', medications: [] },
                neonate:        { status: 'Safe', details: 'No known contraindications in database.', medications: [] },
                kidney_failure: { status: 'Safe', details: 'No known contraindications in database.', medications: [] },
                liver_failure:  { status: 'Safe', details: 'No known contraindications in database.', medications: [] }
            },
            major_interactions: [],
            iv_incompatibility: []
        };

        // ── Helpers ──────────────────────────────────────────────────────

        const collectFacts = (node) => {
            if (!node) return [];
            const results = [];
            if (node.fact) results.push(node);
            if (Array.isArray(node.all)) node.all.forEach(child => results.push(...collectFacts(child)));
            if (Array.isArray(node.any)) node.any.forEach(child => results.push(...collectFacts(child)));
            return results;
        };

        const medsMatch = (med1, med2) => {
            const m1 = String(med1).toLowerCase().trim();
            const m2 = String(med2).toLowerCase().trim();
            return m1.includes(m2) || m2.includes(m1);
        };

        const capitalizeMed = (name) => {
            if (!name) return '';
            return name.charAt(0).toUpperCase() + name.slice(1);
        };

        const searchContainsMed = (ruleValue) => {
            const rv = String(ruleValue).toLowerCase().trim();
            return meds.some(m => medsMatch(rv, m));
        };

        const conditionSatisfiedByMeds = (node) => {
            if (!node) return false;

            if (node.fact === 'medications' && node.value) {
                return searchContainsMed(node.value);
            }
            if (node.fact) return true;

            if (Array.isArray(node.all)) {
                return node.all.every(conditionSatisfiedByMeds);
            }
            if (Array.isArray(node.any)) {
                return node.any.some(conditionSatisfiedByMeds);
            }
            return false;
        };

        const hasMedication = (condition) => {
            const facts = collectFacts(condition);
            return facts.some(f => f.fact === 'medications' && f.value && searchContainsMed(f.value));
        };

        const getMatchingSearchedMeds = (condition) => {
            const facts = collectFacts(condition);
            const matchedMeds = [];
            facts.forEach(f => {
                if (f.fact === 'medications' && f.value) {
                    meds.forEach(searchMed => {
                        if (medsMatch(f.value, searchMed) && !matchedMeds.includes(searchMed)) {
                            matchedMeds.push(searchMed);
                        }
                    });
                }
            });
            return matchedMeds;
        };

        /**
         * Extract the anchor branch and any-branch from a standard
         * { all: [anchor, any(...)] } shape.
         */
        const extractStructuredRule = (cond) => {
            if (!cond || !Array.isArray(cond.all) || cond.all.length !== 2) return null;
            const [first, second] = cond.all;
            const firstIsMed = first && first.fact === 'medications' && first.value;
            const secondIsAny = second && Array.isArray(second.any);
            if (!firstIsMed || !secondIsAny) return null;

            const anchorMeds = [String(first.value).toLowerCase().trim()];
            const coDrugs = second.any
                .filter(f => f && f.fact === 'medications' && f.value)
                .map(f => String(f.value).toLowerCase().trim());

            return { anchorMeds, coDrugs };
        };

        const isPairwiseRule = (cond) => {
            if (!cond) return false;
            if (Array.isArray(cond.any)) {
                return cond.any.every(b => b && Array.isArray(b.all) && b.all.length === 2);
            }
            if (Array.isArray(cond.all) && cond.all.length === 2) {
                return cond.all.every(f => f && f.fact === 'medications');
            }
            return false;
        };

        const extractPairwisePairs = (cond) => {
            const pairs = [];
            const pushPairFromBlock = (block) => {
                if (!block || !Array.isArray(block.all)) return;
                const blockMeds = block.all
                    .filter(f => f && f.fact === 'medications' && f.value)
                    .map(f => String(f.value).toLowerCase().trim());
                if (blockMeds.length === 2) pairs.push(blockMeds);
            };
            if (Array.isArray(cond.any)) {
                cond.any.forEach(pushPairFromBlock);
            } else if (Array.isArray(cond.all)) {
                pushPairFromBlock(cond);
            }
            return pairs;
        };

        const isInteractionRule = (rule) => {
            const lowerName = String(rule.rule_name).toLowerCase();
            const lowerType = String(rule.rule_type).toLowerCase();
            return lowerType.includes('drug_interaction') ||
                   lowerName.includes('interaction') ||
                   lowerName.includes('drug interaction');
        };

        const isIVIncompatibilityRule = (rule) => {
            const lowerName = String(rule.rule_name).toLowerCase();
            const lowerType = String(rule.rule_type).toLowerCase();
            return lowerType === 'iv incompatibility' ||
                   lowerName.includes('iv drug incompatibility') ||
                   lowerName.includes('iv incompatibility') ||
                   lowerName.includes('iv incompat');
        };

        /**
         * Build the pair list for a rule — subset-only.
         *
         * Emits a pair ONLY when BOTH sides of the rule's declared pair are
         * present in the user's `meds` search. If only one side was searched,
         * the rule contributes nothing (no fabricated partner is emitted).
         *
         * Returns null if the rule shape is unrecognised.
         */
        const buildPairsForRule = (cond) => {
            // Case 1: structured rule — all: [anchor, any(co-drugs)]
            const structured = extractStructuredRule(cond);
            if (structured) {
                const { anchorMeds, coDrugs } = structured;

                const anchorInSearch = meds.filter(m =>
                    anchorMeds.some(a => medsMatch(a, m))
                );
                const coDrugsInSearch = meds.filter(m =>
                    coDrugs.some(c => medsMatch(c, m))
                );

                // Subset-only: both sides must be present in the search.
                if (anchorInSearch.length === 0 || coDrugsInSearch.length === 0) {
                    return [];
                }

                const pairs = [];
                anchorInSearch.forEach(a => {
                    coDrugsInSearch.forEach(c => {
                        if (!medsMatch(a, c)) pairs.push([a, c]);
                    });
                });
                return pairs;
            }

            // Case 2: pairwise rule — any of the declared pairs
            if (isPairwiseRule(cond)) {
                const declared = extractPairwisePairs(cond);
                const pairs = [];
                declared.forEach(([a, b]) => {
                    const aIn = meds.find(m => medsMatch(a, m));
                    const bIn = meds.find(m => medsMatch(b, m));

                    // Subset-only: both sides must be present in the search.
                    if (aIn && bIn && !medsMatch(aIn, bIn)) {
                        pairs.push([aIn, bIn]);
                    }
                });
                return pairs;
            }

            // Case 3: unrecognised shape — caller should skip
            return null;
        };

        // ── Main loop ─────────────────────────────────────────────────────

        rules.forEach(rule => {
            const cond = rule.rule_condition;

            if (!cond) return;

            if (!hasMedication(cond)) return;

            if (!conditionSatisfiedByMeds(cond)) {
                console.log(`⏭️  Rule "${rule.rule_name}" rejected: search does not satisfy full condition`);
                return;
            }

            const allFacts = collectFacts(cond);
            const severity = rule.severity;
            const msg = rule.rule_action?.message_client || rule.rule_action?.message || rule.rule_name;
            const rec = rule.rule_action?.recommendation_client || rule.rule_action?.recommendation || '';
            const detail = (rec ? `${msg} ${rec}` : msg);
            const status = (severity === 'critical' || severity === 'high') ? 'Contraindicated' : 'Caution';

            const lowerRuleName = String(rule.rule_name).toLowerCase();
            const lowerRuleType = String(rule.rule_type).toLowerCase();

            const matchedSearchedMeds = getMatchingSearchedMeds(cond);
            const capitalizedMeds = matchedSearchedMeds.map(m => capitalizeMed(m));
            const medsStr = capitalizedMeds.length > 0 ? `[${capitalizedMeds.join(', ')}] ` : '';

            // ============================================
            // Handle Drug Interactions — subset-only
            // ============================================
            if (isInteractionRule(rule)) {
                const pairs = buildPairsForRule(cond);

                if (pairs === null) {
                    console.log(`⚠️ Rule "${rule.rule_name}" has unrecognised interaction shape; skipping`);
                } else {
                    const lines = [];
                    pairs.forEach(([a, b]) => {
                        let line = `${capitalizeMed(a)} + ${capitalizeMed(b)}`;
                        if (msg) line += ` — ${msg}`;
                        if (!lines.includes(line)) lines.push(line);
                    });
                    lines.forEach(line => {
                        if (!safetyProfile.major_interactions.includes(line)) {
                            safetyProfile.major_interactions.push(line);
                        }
                    });
                }
            }

            // ============================================
            // Handle IV Incompatibility — subset-only
            // ============================================
            if (isIVIncompatibilityRule(rule)) {
                const pairs = buildPairsForRule(cond);

                if (pairs === null) {
                    console.log(`⚠️ IV rule "${rule.rule_name}" has unrecognised shape; skipping`);
                } else {
                    const lines = [];
                    pairs.forEach(([a, b]) => {
                        let line = `${capitalizeMed(a)} + ${capitalizeMed(b)}`;
                        if (msg) line += ` — ${msg}`;
                        if (!lines.includes(line)) lines.push(line);
                    });
                    lines.forEach(line => {
                        if (!safetyProfile.iv_incompatibility.includes(line)) {
                            safetyProfile.iv_incompatibility.push(line);
                        }
                    });
                }
            }

            // ============================================
            // Category checks (unchanged behaviour)
            // ============================================

            // Pregnancy
            if (
                lowerRuleType.includes('pregnancy') ||
                lowerRuleName.includes('pregnancy') ||
                allFacts.some(f =>
                    f.fact === 'pregnancy' ||
                    (f.fact === 'conditions' && String(f.value).toLowerCase().includes('pregnancy'))
                )
            ) {
                safetyProfile.categories.pregnancy = {
                    status,
                    details: medsStr + detail,
                    medications: matchedSearchedMeds
                };
            }

            // Lactation
            if (
                lowerRuleType.includes('lactation') ||
                lowerRuleType.includes('breastfeeding') ||
                lowerRuleName.includes('lactation') ||
                lowerRuleName.includes('breastfeeding') ||
                allFacts.some(f =>
                    f.fact === 'lactation' ||
                    (f.fact === 'conditions' && String(f.value).toLowerCase().includes('lactation'))
                )
            ) {
                safetyProfile.categories.lactation = {
                    status,
                    details: medsStr + detail,
                    medications: matchedSearchedMeds
                };
            }

            // Elderly
            if (
                lowerRuleType.includes('elderly') ||
                lowerRuleName.includes('elderly') ||
                lowerRuleName.includes('eldery') ||
                allFacts.some(f => {
                    if (f.fact !== 'age') return false;
                    const v = Number(f.value);
                    return (f.operator === '>=' && v >= 60) ||
                           (f.operator === '>'  && v >= 59) ||
                           (f.operator === 'greaterThan' && v >= 59) ||
                           (f.operator === 'greaterThanOrEqual' && v >= 60) ||
                           (f.operator === 'greaterThanInclusive' && v >= 60);
                })
            ) {
                safetyProfile.categories.elderly = {
                    status,
                    details: medsStr + detail,
                    medications: matchedSearchedMeds
                };
            }

            // Neonate / pediatric
            if (
                lowerRuleType.includes('neonate') ||
                lowerRuleType.includes('pediatric') ||
                lowerRuleType.includes('infant') ||
                lowerRuleName.includes('neonate') ||
                lowerRuleName.includes('pediatric') ||
                lowerRuleName.includes('infant') ||
                allFacts.some(f => {
                    if (f.fact !== 'age') return false;
                    const v = Number(f.value);
                    return (f.operator === '<'  && v <= 18) ||
                           (f.operator === '<=' && v <= 18) ||
                           (f.operator === 'lessThan' && v <= 18) ||
                           (f.operator === 'lessThanOrEqual' && v <= 18);
                })
            ) {
                safetyProfile.categories.neonate = {
                    status,
                    details: medsStr + detail,
                    medications: matchedSearchedMeds
                };
            }

            // Kidney failure
            if (
                lowerRuleType.includes('renal') ||
                lowerRuleType.includes('kidney') ||
                lowerRuleName.includes('renal') ||
                lowerRuleName.includes('kidney') ||
                allFacts.some(f =>
                    f.fact === 'labs.creatinine_clearance' ||
                    f.fact === 'labs.egfr' ||
                    f.fact === 'labs.serum_creatinine' ||
                    (f.fact === 'diagnosis'  && String(f.value).toLowerCase().includes('renal')) ||
                    (f.fact === 'diagnosis'  && String(f.value).toLowerCase().includes('kidney')) ||
                    (f.fact === 'conditions' && String(f.value).toLowerCase().includes('renal')) ||
                    (f.fact === 'conditions' && String(f.value).toLowerCase().includes('kidney'))
                )
            ) {
                safetyProfile.categories.kidney_failure = {
                    status,
                    details: medsStr + detail,
                    medications: matchedSearchedMeds
                };
            }

            // Liver failure
            if (
                lowerRuleType.includes('liver') ||
                lowerRuleType.includes('hepatic') ||
                lowerRuleName.includes('liver') ||
                lowerRuleName.includes('hepatic') ||
                lowerRuleName.includes('cirrhosis') ||
                allFacts.some(f =>
                    f.fact === 'labs.total_bilirubin' ||
                    f.fact === 'labs.ast' ||
                    f.fact === 'labs.alt' ||
                    f.fact === 'labs.inr' ||
                    (f.fact === 'diagnosis'  && String(f.value).toLowerCase().includes('liver')) ||
                    (f.fact === 'diagnosis'  && String(f.value).toLowerCase().includes('hepatic')) ||
                    (f.fact === 'diagnosis'  && String(f.value).toLowerCase().includes('cirrhosis')) ||
                    (f.fact === 'conditions' && String(f.value).toLowerCase().includes('liver')) ||
                    (f.fact === 'conditions' && String(f.value).toLowerCase().includes('hepatic'))
                )
            ) {
                safetyProfile.categories.liver_failure = {
                    status,
                    details: medsStr + detail,
                    medications: matchedSearchedMeds
                };
            }
        });

        safetyProfile.major_interactions = [...new Set(safetyProfile.major_interactions)];
        safetyProfile.iv_incompatibility = [...new Set(safetyProfile.iv_incompatibility)];

        console.log(`✅ IV Incompatibilities found: ${safetyProfile.iv_incompatibility.length}`);
        console.log(`✅ Major Interactions found: ${safetyProfile.major_interactions.length}`);
        console.log('📊 Searched medications:', meds);
        console.log('📊 Interactions:', safetyProfile.major_interactions);
        console.log('📊 IV Incompatibilities:', safetyProfile.iv_incompatibility);

        res.json({
            success: true,
            safetyProfile,
            disclaimer: 'Safety profile generated from internal clinical rules database.'
        });

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

        const resolvedId = await resolvePatientId(patientCode);
        if (!resolvedId) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }

        const hasAccess = await verifyClinicalAccess(resolvedId, req);
        if (!hasAccess) {
            return res.status(403).json({ success: false, error: 'Access denied to this patient record' });
        }

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
            patient_id: resolvedId,
            created_by: userId,
            created_at: new Date().toISOString()
        };
        delete vitalsData.patient_code;
        const { data, error } = await (supabaseAdmin || supabase).from('vitals_history').insert([vitalsData]).select().single();
        if (error) {
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
        delete updates.user_id;
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
            patient_id: resolvedId,
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
        delete updates.user_id;
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
