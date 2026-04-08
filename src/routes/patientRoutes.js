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
        const db = supabaseAdmin || supabase;
        let query = db.from('patients').select('*');

        // 🔐 UNIFIED ACCESS QUERY:
        // Users see:
        // 1. Patients they created or own (based on accessibleUserIds / company logic)
        // 2. Patients shared with them via approved access_requests (if within 24h)
        
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        // Fetch approved access requests for this specific user
        const { data: approvedRequests } = await db
            .from('access_requests')
            .select('patient_id, encrypted_key')
            .eq('requester_id', userId)
            .eq('status', 'approved')
            .gt('approved_at', twentyFourHoursAgo);

        const approvedPatientIds = approvedRequests?.map(r => r.patient_id) || [];
        
        // Build the combined filter
        // 🔐 INCLUSIVE DATA RETRIEVAL (UUID + Email + Company)
        const userEmail = req.user.email;
        const activeIds = [...new Set([...(accessibleUserIds || []), userId, userEmail])];
        
        // Build OR conditions explicitly to avoid PostgREST type mismatch errors
        // Example: user_id.eq.UUID,user_id.eq.Email,id.in.(SharedIDs)
        let ownerConditions = activeIds.map(id => `user_id.eq.${id}`).join(',');
        let sharedCondition = approvedPatientIds.length > 0 ? `,id.in.(${approvedPatientIds.join(',')})` : '';
        
        query = query.or(`${ownerConditions}${sharedCondition}`);
        
        const { data: patients, error: fetchError } = await query.order('created_at', { ascending: false });
        
        if (fetchError) {
            console.error('❌ [DATABASE] Patient retrieval failed. Query attempted for:', activeIds);
            console.error('DATABASE ERROR:', fetchError.message);
            // Fallback: try with only the UUID if the mixed-type query failed (to avoid 500 error)
            const { data: fallbackPatients, error: fallbackError } = await db.from('patients').select('*').eq('user_id', userId).order('created_at', { ascending: false });
            if (!fallbackError) return res.json({ success: true, patients: fallbackPatients || [], message: "Fallback results shown due to type mismatch" });
            throw fetchError;
        }

        if (!patients || patients.length === 0) {
            console.warn(`⚠️ [List Fetch] Zero results found for User: ${userId} (Role: ${userRole}). Active IDs: ${quotedAccessibleIds}`);
        }

        // Attach shared encryption keys where applicable (for support staff decryption)
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
                active_ids: activeUserIds
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

        // Filter out patient_code and sanitize name for individuals
        const userAccountType = req.user.account_type;
        const userRole = req.user.role;
        // Sanitize patient responses ONLY if they are not the owner
        const sanitizedPatients = patients?.map(p => {
            let processedPatient = { ...p };
            
            // Only redact if user is individual AND not the owner/admin
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

// Legacy Get by code - Now points to ID search
router.get('/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const db = supabaseAdmin || supabase;
        
        // Fix: Determine if we should search by 'id' (bigint/uuid) or 'patient_code' (string)
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientCode);
        const isNumeric = /^\d+$/.test(patientCode);
        const isIdSearch = isUUID || isNumeric;

        let query = db.from('patients').select('*');
        
        if (isIdSearch) {
            query = query.eq('id', patientCode);
        } else {
            // If it's a "PAT..." string, search by the patient_code column instead of id
            query = query.eq('patient_code', patientCode);
        }

        const { data, error } = await query.maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Patient not found' });

        // Access check
        if (userRole !== 'admin') {
            const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId, userAccountType);
            if (!accessibleUserIds.includes(data.user_id)) {
                // Check if granted access via access_requests
                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { data: access } = await db.from('access_requests')
                    .select('id')
                    .eq('patient_id', data.id)
                    .eq('requester_id', userId)
                    .eq('status', 'approved')
                    .gt('approved_at', twentyFourHoursAgo)
                    .maybeSingle();

                if (!access) {
                    return res.status(403).json({ success: false, error: 'Access denied' });
                }
            }
        }

        // Access check already handled by query.in('user_id', accessibleUserIds)
        
        // Role-based filtering and name sanitization for individuals (if NOT the owner)
        if (userAccountType === 'individual' && userRole !== 'admin' && data.user_id !== userId) {
            const { patient_code, ...rest } = data;
            const processed = { ...rest };
            if (processed.full_name && processed.full_name.startsWith('Patient PAT')) {
                processed.full_name = 'MR profile';
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

        const isNumeric = /^\d+$/.test(identifier);
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

        const db = supabaseAdmin || supabase;
        let query = db.from('patients').select('*');
        
        if (isNumeric || isUUID) {
            query = query.eq('id', identifier);
        } else {
            // It's a string code (PAT... or HCC...)
            query = query.eq('patient_code', identifier);
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
            console.error('❌ [DATABASE] Fetch error:', error.message);
            // If we got a type error despite our check, try the other column as a last resort
            if (error.message.includes('invalid input syntax for type bigint')) {
                const { data: retryData, error: retryError } = await db.from('patients').select('*').eq('patient_code', identifier).maybeSingle();
                if (retryError) throw retryError;
                if (!retryData) return res.status(404).json({ success: false, error: 'Patient not found' });
                // If retry worked, use it
                return res.json({ success: true, patient: retryData });
            }
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
                // Check if granted access via access_requests
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

        // 🔐 ZERO-KNOWLEDGE: Include the owner's salt so the record can be unlocked (by owner or admin)
        const { data: userData } = await db.from('users').select('encryption_salt').eq('id', data.user_id).maybeSingle();
        const ownerSalt = userData?.encryption_salt || null;

        // Legacy removal - already using UUID
        if (data) {
            // Already clean due to select
        }
        
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
            // Updated: Default to 'MR profile' for all non-admin individual roles
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
            console.error('❌ Database error saving patient:', error);
            // Return specific DB error message to help debug (e.g., type mismatch)
            return res.status(500).json({ 
                success: false, 
                error: `Database: ${error.message} (Code: ${error.code})` 
            });
        }

        // Still hide patient information if individual
        // Still hide patient information if individual (if NOT the owner)
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
        const { data: existing, error: fetchError } = await db.from('patients').select('id, user_id').eq(isIdSearch ? 'id' : 'id', identifier).maybeSingle();
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

        // Admins can delete any patient; owners/company staff can delete patients they have access to
        const isAdmin = userRole === 'admin' || userRole === 'superadmin';
        const isOwner = patient.user_id === userId;
        
        // 🛡️ [ALL USERS] Check accessible IDs for company admins/staff
        const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id, req.user.account_type);
        const hasPermission = isAdmin || isOwner || (accessibleUserIds && accessibleUserIds.includes(patient.user_id));

        if (!hasPermission) {
            return res.status(403).json({ success: false, error: 'You do not have permission to delete this patient' });
        }

        // 🗑️ [CASCADE] Delete all related records first to avoid foreign key constraint errors
        const relatedTables = [
            'medication_reconciliations',
            'medication_reconciliation', // Handle both singular and plural just in case
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
            'patient_access'
        ];

        console.log(`🗑️ [Delete Patient] Cleaning up related data for patient ${patientId}...`);
        
        // Execute all deletions in parallel for efficiency
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

export default router;
