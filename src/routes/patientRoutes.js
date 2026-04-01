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
                limit = 5; // Set to 5 as requested
                limitMessage = 'Pharmacists and pharmacy students can manage up to 5 MRs.';
            } else {
                limit = 5; // Increased from 1 to 5
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

        // Sanitize patient responses
        const sanitizedPatients = patients?.map(p => {
            let processedPatient = { ...p };
            delete processedPatient.patient_code;
            return processedPatient;
        }) || [];

        res.json({
            success: true,
            patients: sanitizedPatients,
            count: sanitizedPatients.length,
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

        // Filter out patient_code and sanitize name for individuals
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;
        const sanitizedPatients = patients?.map(p => {
            let processedPatient = { ...p };
            if (userAccountType === 'individual' && userRole !== 'admin') {
                const { patient_code, ...rest } = processedPatient;
                processedPatient = rest;
                
                // Also sanitize full_name if it contains Patient PAT...
                if (processedPatient.full_name && processedPatient.full_name.startsWith('Patient PAT')) {
                    processedPatient.full_name = 'Patient Profile';
                }
            }
            return processedPatient;
        }) || [];

        res.json({ success: true, patients: sanitizedPatients, count: sanitizedPatients.length });
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

        const db = supabaseAdmin || supabase;
        let query = db.from('patients').select('*').eq('patient_code', patientCode);

        const { data, error } = await query.maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Patient not found' });

        // Access check
        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (!accessibleUserIds.includes(data.user_id)) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        }

        // Access check already handled by query.in('user_id', accessibleUserIds)
        
        // Final role-based filtering and name sanitization for individuals
        if (userAccountType === 'individual' && userRole !== 'admin') {
            const { patient_code, ...rest } = data;
            const processed = { ...rest };
            if (processed.full_name && processed.full_name.startsWith('Patient PAT')) {
                processed.full_name = 'Patient Profile';
            }
            return res.json({ success: true, patient: processed });
        }

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

        console.log(`🔍 [DEBUG] Fetching patient by identifier: "${identifier}"`);
        // Determine if identifier is UUID or Code - simplified and more inclusive regex
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
        const isNumeric = /^\d+$/.test(identifier);
        const isIdSearch = isUUID || isNumeric;
        console.log(`🔍 [DEBUG] Identifier type: ${isUUID ? 'UUID' : (isNumeric ? 'Numeric ID' : 'Code')}`);

        const db = supabaseAdmin || supabase;
        if (!isIdSearch) return res.status(404).json({ success: false, error: 'Invalid patient identifier' });
        const { data, error } = await db.from('patients').select('*').eq('id', identifier).maybeSingle();

        if (error) {
            console.error('❌ [DATABASE] Fetch error:', error.message);
            throw error;
        }

        if (!data) {
            console.warn(`⚠️ [NOT FOUND] Patient "${identifier}" not found in DB`);
            return res.status(404).json({ success: false, error: 'Patient not found' });
        }

        // Apply access control manually since we are using admin client
        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (!accessibleUserIds.includes(data.user_id)) {
                console.warn(`🔒 [BLOCK] Access denied for requester ${userId} to patient ${data.id} (owned by ${data.user_id})`);
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        }

        // 🔐 ZERO-KNOWLEDGE: Include the owner's salt so the record can be unlocked (by owner or admin)
        const { data: userData } = await db.from('users').select('encryption_salt').eq('id', data.user_id).maybeSingle();
        const ownerSalt = userData?.encryption_salt || null;

        // Remove legacy patient_code
        if (data) delete data.patient_code;
        
        res.json({ 
            success: true, 
            patient: data,
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

        // Check if user is individual (not company and not admin)
        const isIndividual = userAccountType === 'individual' && !req.user.company_id;
        
        // Only require full_name for non-individual users
        if (!isIndividual) {
            if (!patientData.full_name) {
                return res.status(400).json({ success: false, error: 'Patient name is required' });
            }
        }

        // ✅ INDIVIDUAL PATIENT LIMIT: Different limits based on role
        if (userAccountType === 'individual' && !req.user.company_id) {
            const { count, error: countError } = await supabase
                .from('patients')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            if (countError) {
                return res.status(500).json({ success: false, error: 'Failed to verify patient limit' });
            }

            // Determine limit based on role
            let limit = 5; // Set to 5 for standard individuals
            let roleType = 'standard individual';
            let limitMessage = 'Individual subscription allows up to 5 MRs. Please upgrade to Company subscription for unlimited access.';
            
            if (userRole === 'pharmacist' || userRole === 'pharmacy_student') {
                limit = 5; // Set to 5 as requested
                roleType = 'pharmacist/pharmacy student';
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
                        }
                    } else {
                        console.warn('⚠️ [FIX] Source user not found in company_users, cannot sync.');
                    }
                }
            } catch (err) { console.warn('Sync exception:', err.message); }
        }
        // -------------------------------------------------------------------------------

        // For individual users with no name, generate a default name
        if (isIndividual && (!patientData.full_name || patientData.full_name.trim() === '')) {
            // Updated: Default to 'Patient Profile' for all non-admin individual roles
            const isRestrictedIndividual = userAccountType === 'individual' && userRole !== 'admin';
            const defaultName = isRestrictedIndividual ? 'Patient Profile' : `Patient ${patientData.patient_code || new Date().getTime()}`;
            patientData.full_name = defaultName;
        }

        const patientToCreate = {
            ...patientData,
            user_id: patientData.user_id && patientData.user_id !== 'admin' ? patientData.user_id : user_id,
            created_by: created_by,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        delete patientToCreate.id;

        // Legacy patient_code generation removed. 
        // We now rely exclusively on the database primary key (id).
        delete patientToCreate.patient_code;

        // Clean empty values
        Object.keys(patientToCreate).forEach(k => {
            if (typeof patientToCreate[k] === 'string' && !patientToCreate[k].trim()) {
                patientToCreate[k] = null;
            }
        });

        const targetDb = supabaseAdmin || supabase;
        const { data, error } = await targetDb.from('patients').insert([patientToCreate]).select().single();

        if (error) {
            if (error.code === '23503') { }
            throw error;
        }

        // Still hide patient_code in the creation response if individual
        if (userAccountType === 'individual' && userRole !== 'admin') {
            const { patient_code, ...rest } = data;
            const processed = { ...rest };
            if (processed.full_name && processed.full_name.startsWith('Patient PAT')) {
                processed.full_name = 'Patient Profile';
            }
            return res.status(201).json({ success: true, message: 'Created', patient: processed });
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

        const isIdSearch = identifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) || /^\d+$/.test(identifier);

        const db = supabaseAdmin || supabase;
        const { data: existing, error: fetchError } = await db.from('patients').select('*').eq(isIdSearch ? 'id' : 'patient_code', identifier).maybeSingle();
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

        const db = supabaseAdmin || supabase;
        const { data: existing, error: fetchError } = await db
            .from('patients')
            .select('*')
            .eq('patient_code', patientCode)
            .maybeSingle();

        if (fetchError) throw fetchError;
        if (!existing) return res.status(404).json({ success: false, error: 'Patient not found' });

        const accessibleIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const hasPermission = userRole === 'admin' || (accessibleIds && accessibleIds.includes(existing.user_id));

        if (!hasPermission) return res.status(403).json({ success: false, error: 'Access denied' });

        const updates = { ...req.body, updated_at: new Date().toISOString() };
        ['id', 'user_id', 'created_at', 'created_by', 'patient_code'].forEach(k => delete updates[k]);

        const { data, error } = await db.from('patients').update(updates).eq('id', existing.id).select().single();
        if (error) throw error;

        res.json({ success: true, message: 'Updated', patient: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message || 'Failed' });
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

        // Admins can delete any patient; owners/company staff can delete patients they have access to
        const isAdmin = userRole === 'admin' || userRole === 'superadmin';
        const isOwner = patient.user_id === userId;
        
        // 🛡️ [ALL USERS] Check accessible IDs for company admins/staff
        const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const hasPermission = isAdmin || isOwner || (accessibleUserIds && accessibleUserIds.includes(patient.user_id));

        if (!hasPermission) {
            return res.status(403).json({ success: false, error: 'You do not have permission to delete this patient' });
        }

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

export default router;
