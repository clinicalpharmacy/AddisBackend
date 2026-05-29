import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken, getUserAccessibleData } from '../middleware/authMiddleware.js';
import { sanitizeSearchQuery } from '../utils/helpers.js';

const router = express.Router();

// Get patient count for current user (with role-based limits)
router.get('/count', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userAccountType = req.user.account_type || 'individual';

        const { count, error } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (error) {
            return res.status(500).json({
                success: false,
                error: 'Failed to get patient count'
            });
        }

        // Calculate limit based on role for frontend display
        let limit = 'unlimited';
        let limitMessage = '';
        
        if (userRole === 'admin' || userRole === 'superadmin') {
            limit = 'unlimited';
            limitMessage = 'Administrators have unlimited patient access.';
        } 
        else if (userAccountType === 'company' || req.user.company_id) {
            limit = 'unlimited';
            limitMessage = 'Company users have unlimited patient access.';
        } 
        else if (userAccountType === 'individual') {
            if (userRole === 'pharmacist' || userRole === 'pharmacy_student') {
                limit = 5;
                limitMessage = 'Pharmacists and pharmacy students can manage up to 5 MRs.';
            } else {
                limit = 5;
                limitMessage = 'Individual users are limited to 5 MRs. Upgrade to Company subscription for unlimited access.';
            }
        }

        res.json({
            success: true,
            count: count || 0,
            limit: limit,
            role: userRole,
            account_type: userAccountType,
            message: limitMessage,
            canAddMore: limit === 'unlimited' ? true : (count < limit)
        });

    } catch (error) {
        console.error('Error in patient count route:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

// Get all patients with role-based filtering
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type || 'individual';

        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
        const db = supabaseAdmin || supabase;
        let query = db.from('patients').select('*');

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        const { data: approvedRequests } = await db
            .from('access_requests')
            .select('patient_id, encrypted_key')
            .eq('requester_id', userId)
            .eq('status', 'approved')
            .gt('approved_at', twentyFourHoursAgo);

        const approvedPatientIds = approvedRequests?.map(r => r.patient_id) || [];
        
        const userEmail = req.user.email;
        const activeIds = [...new Set([...(accessibleUserIds || []), userId, userEmail])];
        
        const validActiveIds = activeIds.filter(id => 
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || /^\d+$/.test(id)
        );
        
        if (validActiveIds.length === 0) {
            return res.json({ success: true, patients: [], message: "No valid user IDs identified for access check" });
        }

        let ownerConditions = validActiveIds.map(id => `user_id.eq.${id}`).join(',');
        let sharedCondition = (approvedPatientIds.length > 0) ? `,id.in.(${approvedPatientIds.join(',')})` : '';
        
        query = query.or(`${ownerConditions}${sharedCondition}`);
        
        const { data: patients, error: fetchError } = await query.order('created_at', { ascending: false });
        
        if (fetchError) {
            console.error('❌ [DATABASE] Patient retrieval failed. Query attempted for:', activeIds);
            console.error('DATABASE ERROR:', fetchError.message);
            const { data: fallbackPatients, error: fallbackError } = await db.from('patients').select('*').eq('user_id', userId).order('created_at', { ascending: false });
            if (!fallbackError) return res.json({ success: true, patients: fallbackPatients || [], message: "Fallback results shown due to type mismatch" });
            throw fetchError;
        }

        if (!patients || patients.length === 0) {
            console.warn(`⚠️ [List Fetch] Zero results found for User: ${userId} (Role: ${userRole}). Active IDs: ${JSON.stringify(activeIds)}`);
        }

        const sanitizedPatients = (patients || []).map(p => {
            const request = approvedRequests?.find(r => r.patient_id === p.id);
            return { 
                ...p, 
                shared_encryption_key: request?.encrypted_key || null,
                _is_shared: !!request
            };
        });

        return res.json({ 
            success: true, 
            patients: sanitizedPatients,
            count: sanitizedPatients.length,
            access_info: { 
                role: userRole, 
                combined: true,
                debug_userId: userId,
                active_ids: validActiveIds
            }
        });
    } catch (error) {
        console.error('❌ [DATABASE] Failed to fetch patient list:', error.message);
        res.status(500).json({ success: false, error: error.message || 'Failed to load patients' });
    }
});

// Get own patients
router.get('/my-patients', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: patients, error } = await supabase.from('patients').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) throw error;

        const userAccountType = req.user.account_type;
        const userRole = req.user.role;
        const sanitizedPatients = patients?.map(p => {
            let processedPatient = { ...p };
            
            if (userAccountType === 'individual' && userRole !== 'admin' && p.user_id !== userId) {
                if (processedPatient.full_name && processedPatient.full_name.startsWith('Patient PAT')) {
                    processedPatient.full_name = 'MR profile';
                }
            }
            return processedPatient;
        }) || [];

        res.json({ success: true, patients: sanitizedPatients, count: sanitizedPatients.length });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
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

        const isNumeric = /^\d+$/.test(identifier);
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

        const db = supabaseAdmin || supabase;

        if (!isNumeric && !isUUID) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        const { data, error } = await db.from('patients').select('*').eq('id', identifier).maybeSingle();

        if (error) {
            console.error('❌ [DATABASE] Fetch error:', error.message);
            throw error;
        }

        if (!data) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (!accessibleUserIds.includes(data.user_id)) {
                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { data: access } = await db.from('access_requests')
                    .select('id')
                    .eq('patient_id', data.id)
                    .eq('requester_id', userId)
                    .eq('status', 'approved')
                    .gt('approved_at', twentyFourHoursAgo)
                    .maybeSingle();

                if (!access) {
                    console.warn(`🔒 [BLOCK] Access denied for requester ${userId} to patient ${data.id} (owned by ${data.user_id})`);
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }
            }
        }

        const { data: userData } = await db.from('users').select('encryption_salt').eq('id', data.user_id).maybeSingle();
        const ownerSalt = userData?.encryption_salt || null;

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: accessGrant } = await db.from('access_requests')
            .select('encrypted_key')
            .eq('patient_id', data.id)
            .eq('requester_id', userId)
            .eq('status', 'approved')
            .gt('approved_at', twentyFourHoursAgo)
            .maybeSingle();

        const enrichedPatient = {
            ...data,
            shared_encryption_key: accessGrant?.encrypted_key || null,
            _is_shared: !!accessGrant
        };
        
        res.json({ 
            success: true, 
            patient: enrichedPatient,
            owner_salt: ownerSalt 
        });

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
        const userRole = req.user.role;
        const patientData = req.body;

        const isIndividual = userAccountType === 'individual' && !req.user.company_id;
        
        if (!isIndividual) {
            if (!patientData.full_name) {
                return res.status(400).json({ success: false, error: 'Patient name is required' });
            }
        }

        if (userAccountType === 'individual' && !req.user.company_id) {
            const { count, error: countError } = await supabase
                .from('patients')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            if (countError) {
                return res.status(500).json({ success: false, error: 'Failed to verify patient limit' });
            }

            let limit = 5;
            let limitMessage = 'Individual subscription allows up to 5 MRs. Please upgrade to Company subscription for unlimited access.';
            
            if (userRole === 'pharmacist' || userRole === 'pharmacy_student') {
                limit = 5;
                limitMessage = 'As a pharmacist or pharmacy student, you can manage up to 5 MRs.';
            }

            if (count >= limit) {
                return res.status(403).json({
                    success: false,
                    error: 'Patient limit reached',
                    message: `You have reached your maximum of ${limit} patient${limit > 1 ? 's' : ''}. ${limitMessage}`,
                    limit: limit,
                    current: count,
                    role: userRole,
                    account_type: userAccountType,
                    canAddMore: false
                });
            }
        }

        let user_id = userId;
        let created_by = userId;

        if ((req.user.account_type === 'company_user' || req.user.role === 'company_admin') && userId) {
            try {
                const db = supabaseAdmin || supabase;
                const { data: exists } = await db.from('users').select('id').eq('id', userId).maybeSingle();
                if (!exists) {
                    const { data: sourceUser } = await db.from('company_users').select('*').eq('id', userId).maybeSingle();

                    if (sourceUser) {
                        const { error: syncErr } = await db.from('users').insert([{
                            id: userId,
                            email: sourceUser.email,
                            full_name: sourceUser.full_name,
                            role: sourceUser.role,
                            company_id: sourceUser.company_id,
                            approved: true,
                            password_hash: sourceUser.password_hash || 'SYNCED_PROVIDER'
                        }]);

                        if (syncErr) {
                            console.error('❌ [FIX] Sync failed:', syncErr.message);
                        }
                    } else {
                        console.warn('⚠️ [FIX] Source user not found in company_users, cannot sync.');
                    }
                }
            } catch (err) { console.warn('Sync exception:', err.message); }
        }

        if (isIndividual && (!patientData.full_name || patientData.full_name.trim() === '')) {
            const isRestrictedIndividual = userAccountType === 'individual' && userRole !== 'admin';
            const defaultName = isRestrictedIndividual ? 'MR profile' : `Patient ${patientData.patient_code || new Date().getTime()}`;
            patientData.full_name = defaultName;
        }

        const patientToCreate = {
            ...patientData,
            user_id: (patientData.user_id && patientData.user_id !== 'admin') ? patientData.user_id : userId,
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        delete patientToCreate.id;
        delete patientToCreate.patient_code;

        Object.keys(patientToCreate).forEach(k => {
            if (typeof patientToCreate[k] === 'string' && !patientToCreate[k].trim()) {
                patientToCreate[k] = null;
            }
        });

        const targetDb = supabaseAdmin || supabase;
        const { data, error } = await targetDb.from('patients').insert([patientToCreate]).select().single();

        if (error) {
            console.error('❌ Database error saving patient:', error);
            return res.status(500).json({ 
                success: false, 
                error: `Database: ${error.message} (Code: ${error.code})` 
            });
        }

        if (userAccountType === 'individual' && userRole !== 'admin' && data.user_id !== userId) {
            const processed = { ...data };
            if (processed.full_name && processed.full_name.startsWith('Patient PAT')) {
                processed.full_name = 'MR profile';
            }
            return res.status(201).json({ success: true, message: 'Created', patient: processed });
        }
 
        res.status(201).json({ success: true, message: 'Created', patient: data });
    } catch (e) {
        console.error('❌ Server exception in create patient:', e);
        res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// Update patient (by ID or Code)
router.put('/:identifier', authenticateToken, async (req, res) => {
    try {
        const identifier = req.params.identifier;
        const userId = req.user.userId;
        const userRole = req.user.role;

        const isIdSearch = identifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) || /^\d+$/.test(identifier);

        const db = supabaseAdmin || supabase;
        const { data: existing, error: fetchError } = await db.from('patients').select('id, user_id').eq('id', identifier).maybeSingle();
        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ success: false, error: 'Patient not found' });

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

        const { data, error } = await db.from('patients').update(updates).eq('id', existing.id).select().single();
        
        if (error) {
            console.error('❌ Database error updating patient:', error);
            return res.status(500).json({ 
                success: false, 
                error: `Database: ${error.message} (Code: ${error.code})` 
            });
        }

        res.json({ success: true, message: 'Updated', patient: data });
    } catch (e) {
        console.error('❌ Server exception in update patient:', e);
        res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// Update by code (Legacy support)
router.put('/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;

        const db = supabaseAdmin || supabase;

        const { data: existing, error: fetchError } = await db.from('patients').select('*').eq('id', patientCode).maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ success: false, error: 'Patient not found' });

        const accessibleIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const hasPermission = userRole === 'admin' || (accessibleIds && accessibleIds.includes(existing.user_id));

        if (!hasPermission) return res.status(403).json({ success: false, error: 'Access denied' });

        const updates = { ...req.body, updated_at: new Date().toISOString() };
        ['id', 'user_id', 'created_at', 'created_by', 'patient_code'].forEach(k => delete updates[k]);

        const { data, error } = await db.from('patients').update(updates).eq('id', existing.id).select().single();
        
        if (error) {
            console.error('❌ Database error updating patient by code:', error);
            return res.status(500).json({ 
                success: false, 
                error: `Database: ${error.message} (Code: ${error.code})` 
            });
        }

        res.json({ success: true, message: 'Updated', patient: data });
    } catch (e) {
        console.error('❌ Server exception in update patient by code:', e);
        res.status(500).json({ success: false, error: e.message || 'Server error' });
    }
});

// ================= DELETE ROUTES =====================

// Delete by ID
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;
        const userId = req.user.userId;
        const userRole = req.user.role;

        const db = supabaseAdmin || supabase;
        const { data: patient } = await db.from('patients').select('user_id').eq('id', patientId).single();
        if (!patient) return res.status(404).json({ success: false, error: 'Patient not found' });

        const isAdmin = userRole === 'admin' || userRole === 'superadmin';
        const isOwner = patient.user_id === userId;
        
        const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const hasPermission = isAdmin || isOwner || (accessibleUserIds && accessibleUserIds.includes(patient.user_id));

        if (!hasPermission) {
            return res.status(403).json({ success: false, error: 'You do not have permission to delete this patient' });
        }

        const relatedTables = [
            'medication_reconciliations',
            'medication_reconciliation',
            'drn_assessments',
            'medication_history',
            'plans',
            'costs',
            'outcomes',
            'pharmacotherapy_monitoring',
            'vaccination_status',
            'social_history',
            'patient_physical_assessment',
            'lab_results',
            'vital_signs',
            'patient_access',
            'pharmacy_assistance_plans'
        ];

        console.log(`🗑️ [Delete Patient] Cleaning up related data for patient ${patientId}...`);
        
        await Promise.all(relatedTables.map(table => 
            db.from(table).delete().eq('patient_id', patientId)
        ));

        const { error } = await db.from('patients').delete().eq('id', patientId);
        if (error) throw error;

        res.json({ success: true, message: 'Patient deleted successfully' });
    } catch (e) {
        console.error('❌ [Delete Patient] Error:', e.message);
        res.status(500).json({ success: false, error: e.message || 'Failed to delete patient' });
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
            .or(`full_name.ilike.%${query}%,contact_number.ilike.%${query}%,diagnosis.ilike.%${query}%`)
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

// ================= PHARMACY ASSISTANCE PLANS ROUTES =================

// Helper function to find patient by code or ID
const findPatientByIdentifier = async (identifier) => {
    let query = supabase.from('patients').select('id, user_id, patient_code');
    
    if (/^\d+$/.test(identifier)) {
        query = query.eq('id', identifier);
    } else {
        query = query.eq('patient_code', identifier);
    }
    
    const { data, error } = await query.maybeSingle();
    return { data, error };
};

// Get pharmacy plans for a patient (accepts patient_code or ID)
router.get('/pharmacy-plans/patient/:patientIdentifier', authenticateToken, async (req, res) => {
    try {
        const { patientIdentifier } = req.params;
        const userId = req.user.userId;
        const userRole = req.user.role;

        // Find patient by code or ID
        const { data: patient, error: patientError } = await findPatientByIdentifier(patientIdentifier);

        if (patientError || !patient) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        // Check permission
        if (userRole !== 'admin' && patient.user_id !== userId) {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data: access } = await supabase
                .from('access_requests')
                .select('id')
                .eq('patient_id', patient.id)
                .eq('requester_id', userId)
                .eq('status', 'approved')
                .gt('approved_at', twentyFourHoursAgo)
                .maybeSingle();

            if (!access) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        }

        // Fetch pharmacy plans
        const { data: plans, error } = await supabase
            .from('pharmacy_assistance_plans')
            .select('*')
            .eq('patient_id', patient.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ success: true, plans: plans || [] });
    } catch (error) {
        console.error('Error fetching pharmacy plans:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new pharmacy assistance plan (accepts patient_code)
router.post('/pharmacy-plans', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { patient_code, plan_type, goals, medications, monitoring, follow_up, notes } = req.body;

        // Validate required fields
        if (!patient_code || !goals || !notes) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: patient_code, goals, and notes are required' 
            });
        }

        // Find patient by code
        const { data: patient, error: patientError } = await findPatientByIdentifier(patient_code);

        if (patientError || !patient) {
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        // Check permission
        if (req.user.role !== 'admin' && patient.user_id !== userId) {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data: access } = await supabase
                .from('access_requests')
                .select('id')
                .eq('patient_id', patient.id)
                .eq('requester_id', userId)
                .eq('status', 'approved')
                .gt('approved_at', twentyFourHoursAgo)
                .maybeSingle();

            if (!access) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        }

        // Create the plan
        const planData = {
            patient_id: patient.id,
            user_id: userId,
            plan_type: plan_type || null,
            goals: goals,
            medications: medications || '',
            monitoring: monitoring || '',
            follow_up: follow_up || null,
            notes: notes,
            created_at: new Date(),
            updated_at: new Date()
        };

        const { data, error } = await supabase
            .from('pharmacy_assistance_plans')
            .insert([planData])
            .select()
            .single();

        if (error) {
            console.error('Database error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.status(201).json({ success: true, plan: data });
    } catch (error) {
        console.error('Error creating pharmacy plan:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update pharmacy plan
router.put('/pharmacy-plans/:planId', authenticateToken, async (req, res) => {
    try {
        const { planId } = req.params;
        const userId = req.user.userId;
        const { plan_type, goals, medications, monitoring, follow_up, notes } = req.body;

        // Get existing plan
        const { data: existingPlan, error: fetchError } = await supabase
            .from('pharmacy_assistance_plans')
            .select('*')
            .eq('id', planId)
            .single();

        if (fetchError || !existingPlan) {
            return res.status(404).json({ success: false, error: 'Plan not found' });
        }

        // Check permission
        if (req.user.role !== 'admin' && existingPlan.user_id !== userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Update plan
        const updates = {
            plan_type: plan_type !== undefined ? plan_type : existingPlan.plan_type,
            goals: goals || existingPlan.goals,
            medications: medications !== undefined ? medications : existingPlan.medications,
            monitoring: monitoring !== undefined ? monitoring : existingPlan.monitoring,
            follow_up: follow_up !== undefined ? follow_up : existingPlan.follow_up,
            notes: notes || existingPlan.notes,
            updated_at: new Date()
        };

        const { data, error } = await supabase
            .from('pharmacy_assistance_plans')
            .update(updates)
            .eq('id', planId)
            .select()
            .single();

        if (error) throw error;

        res.json({ success: true, plan: data });
    } catch (error) {
        console.error('Error updating pharmacy plan:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete pharmacy plan
router.delete('/pharmacy-plans/:planId', authenticateToken, async (req, res) => {
    try {
        const { planId } = req.params;
        const userId = req.user.userId;

        // Check permission
        const { data: plan, error: fetchError } = await supabase
            .from('pharmacy_assistance_plans')
            .select('user_id')
            .eq('id', planId)
            .single();

        if (fetchError || !plan) {
            return res.status(404).json({ success: false, error: 'Plan not found' });
        }

        if (req.user.role !== 'admin' && plan.user_id !== userId) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Delete plan
        const { error } = await supabase
            .from('pharmacy_assistance_plans')
            .delete()
            .eq('id', planId);

        if (error) throw error;

        res.json({ success: true, message: 'Plan deleted successfully' });
    } catch (error) {
        console.error('Error deleting pharmacy plan:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
