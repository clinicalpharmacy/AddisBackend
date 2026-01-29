import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken, getUserAccessibleData } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/test', async (req, res) => {
    try {
        if (!supabase) return res.json({ success: false, message: 'Supabase not configured' });
        const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
        res.json({ success: true, message: 'Debug test success', user_count: count });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/db-test', async (req, res) => {
    try {
        if (!supabase) return res.json({ success: false });
        const { data, error } = await supabase.from('users').select('*').limit(5);
        if (error) return res.json({ success: false, error: error.message });
        res.json({ success: true, message: 'DB Connected', rows: data?.length || 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Test if users can see each other's data
router.get('/can-i-see-others-data', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userEmail = req.user.email;

        // Test 1: Try to get ALL patients (what regular endpoint does)
        const { data: allPatients } = await supabase
            .from('patients')
            .select('*');

        // Test 2: Get only user's own patients
        const { data: ownPatients } = await supabase
            .from('patients')
            .select('*')
            .eq('user_id', userId);

        // Test 3: Count total patients in system
        const totalPatients = allPatients ? allPatients.length : 0;
        const ownPatientsCount = ownPatients ? ownPatients.length : 0;
        const otherPatientsCount = totalPatients - ownPatientsCount;

        // Test 4: Check if patient records have user_id
        let patientsWithUserIds = 0;
        let patientsWithoutUserIds = 0;

        if (allPatients) {
            allPatients.forEach(p => {
                if (p.user_id) {
                    patientsWithUserIds++;
                } else {
                    patientsWithoutUserIds++;
                }
            });
        }

        res.json({
            success: true,
            current_user: {
                id: userId,
                email: userEmail,
                role: userRole
            },
            patient_analysis: {
                total_patients_in_system: totalPatients,
                your_patients: ownPatientsCount,
                other_users_patients: otherPatientsCount,
                can_you_see_others_data: otherPatientsCount > 0 ? 'YES - Data leak!' : 'NO - Good!',
                patient_ownership_status: {
                    patients_with_user_id: patientsWithUserIds,
                    patients_without_user_id: patientsWithoutUserIds,
                    percentage_with_owner: totalPatients > 0 ? ((patientsWithUserIds / totalPatients) * 100).toFixed(1) + '%' : 'N/A'
                }
            },
            data_isolation_status: userRole === 'admin'
                ? '✅ Admin SHOULD see all data'
                : otherPatientsCount > 0
                    ? '❌ REGULAR USER SHOULD NOT see other users\' data, but they CAN!'
                    : '✅ Regular user correctly sees only their own data',
            recommendation: otherPatientsCount > 0 && userRole !== 'admin'
                ? 'URGENT: Fix getUserAccessibleData() function - it returns too many user IDs'
                : 'Data isolation is working correctly'
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Find out who owns the patients and test data isolation
router.get('/who-owns-patients', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userEmail = req.user.email;

        // STEP 1: Get ALL patients in system
        const { data: allPatients, error: patientsError } = await supabase
            .from('patients')
            .select('*');

        if (patientsError) {
            throw patientsError;
        }

        // STEP 2: Get user's own patients
        const { data: ownPatients, error: ownError } = await supabase
            .from('patients')
            .select('*')
            .eq('user_id', userId);

        // STEP 3: Group patients by owner
        const patientsByOwner = {};
        const unknownOwners = [];

        if (allPatients) {
            allPatients.forEach(patient => {
                const ownerId = patient.user_id;
                if (!ownerId) {
                    unknownOwners.push(patient);
                } else {
                    if (!patientsByOwner[ownerId]) {
                        patientsByOwner[ownerId] = [];
                    }
                    patientsByOwner[ownerId].push(patient);
                }
            });
        }

        // STEP 4: Get user info for each owner
        const ownerIds = Object.keys(patientsByOwner);
        let ownerInfo = {};

        if (ownerIds.length > 0) {
            const { data: owners, error: ownersError } = await supabase
                .from('users')
                .select('id, email, role, full_name')
                .in('id', ownerIds);

            if (!ownersError && owners) {
                owners.forEach(owner => {
                    ownerInfo[owner.id] = {
                        email: owner.email,
                        role: owner.role,
                        full_name: owner.full_name
                    };
                });
            }
        }

        // STEP 5: Test what this user can see through regular endpoint
        // getUserAccessibleData imported from middleware
        const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);

        let accessiblePatients = [];
        if (accessibleUserIds.length > 0) {
            const { data: patientsUserCanSee } = await supabase
                .from('patients')
                .select('*')
                .in('user_id', accessibleUserIds);

            accessiblePatients = patientsUserCanSee || [];
        }

        // STEP 6: Analysis
        const totalPatients = allPatients ? allPatients.length : 0;
        const userOwnPatients = ownPatients ? ownPatients.length : 0;
        const patientsUserCanAccess = accessiblePatients.length;
        const otherPatientsUserCanSee = patientsUserCanAccess - userOwnPatients;

        res.json({
            success: true,
            current_user: {
                id: userId,
                email: userEmail,
                role: userRole
            },
            patient_ownership_analysis: {
                total_patients_in_system: totalPatients,
                your_patients: userOwnPatients,
                patients_you_can_access: patientsUserCanAccess,
                other_patients_you_can_see: otherPatientsUserCanSee,
                unknown_ownership_patients: unknownOwners.length
            },
            detailed_breakdown: {
                patients_by_owner: Object.keys(patientsByOwner).map(ownerId => ({
                    owner_id: ownerId,
                    owner_info: ownerInfo[ownerId] || { note: 'User not found in database' },
                    patient_count: patientsByOwner[ownerId].length,
                    sample_patient: patientsByOwner[ownerId][0] ? {
                        id: patientsByOwner[ownerId][0].id,
                        name: patientsByOwner[ownerId][0].full_name,
                        created: patientsByOwner[ownerId][0].created_at
                    } : null
                })),
                unknown_owners: unknownOwners.map(p => ({
                    id: p.id,
                    name: p.full_name,
                    created: p.created_at,
                    note: 'No user_id assigned'
                }))
            },
            data_isolation_test: {
                accessible_user_ids: accessibleUserIds,
                accessible_users_count: accessibleUserIds.length,
                includes_self: accessibleUserIds.includes(userId),
                sample_accessible_patients: accessiblePatients.slice(0, 3).map(p => ({
                    id: p.id,
                    name: p.full_name,
                    owner: p.user_id,
                    is_yours: p.user_id === userId
                }))
            },
            conclusion: {
                data_isolation_status: userRole === 'admin'
                    ? '✅ Admin correctly sees all patients'
                    : otherPatientsUserCanSee > 0
                        ? `❌ DATA LEAK: ${userRole} user can see ${otherPatientsUserCanSee} other users' patients!`
                        : '✅ Data isolation working: User only sees their own patients',
                issue_found: otherPatientsUserCanSee > 0 && userRole !== 'admin'
                    ? `The getUserAccessibleData() function returns ${accessibleUserIds.length} user IDs instead of just [${userId}]`
                    : 'No data isolation issue detected'
            },
            recommendations: otherPatientsUserCanSee > 0 && userRole !== 'admin'
                ? [
                    '1. Fix getUserAccessibleData() function',
                    '2. Ensure it returns ONLY [userId] for non-admin users',
                    '3. Check user roles in JWT tokens',
                    '4. Verify database permissions'
                ]
                : [
                    '1. Data isolation appears to be working',
                    '2. Regular users can only see their own data'
                ]
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

export default router;
