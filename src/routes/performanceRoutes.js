import express from 'express';
import { supabase } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * Get comprehensive performance report for company users
 * Only accessible by company admins
 */
router.get('/company-performance', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const companyId = req.user.company_id;

        // Verify user is a company admin or super admin
        if (userRole !== 'company_admin' && userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Only company admins can view performance reports.'
            });
        }

        if (!companyId) {
            return res.status(400).json({
                success: false,
                error: 'Company ID not found'
            });
        }

        // Get both company admin (from users) and pharmacists (from company_users)
        const [adminsResult, pharmacistsResult] = await Promise.all([
            supabase
                .from('users')
                .select('id, email, full_name, role, created_at')
                .eq('company_id', companyId)
                .in('role', ['company_admin', 'admin']),
            supabase
                .from('company_users')
                .select('id, email, full_name, role, created_at')
                .eq('company_id', companyId)
        ]);

        if (adminsResult.error) throw adminsResult.error;
        if (pharmacistsResult.error) throw pharmacistsResult.error;

        const allUsers = [
            ...(adminsResult.data || []),
            ...(pharmacistsResult.data || [])
        ];

        if (allUsers.length === 0) {
            return res.json({
                success: true,
                report: {
                    company_id: companyId,
                    total_users: 0,
                    user_performance: [],
                    summary: {
                        total_patients: 0,
                        total_medications: 0,
                        total_assessments: 0,
                        total_plans: 0,
                        total_outcomes: 0
                    }
                }
            });
        }

        const userIds = allUsers.map(u => u.id);

        // Fetch performance data for each metric
        // 1. First, fetch all patients created by these users to get their patient_codes
        const { data: userPatients, error: patientsError } = await supabase
            .from('patients')
            .select('user_id, created_at, patient_code')
            .in('user_id', userIds);

        if (patientsError) throw patientsError;

        const allPatientCodes = userPatients?.map(p => p.patient_code) || [];

        // 2. Now fetch related data only if we have patients
        let medicationsData = { data: [] };
        let assessmentsData = { data: [] };
        let plansData = { data: [] };
        let outcomesData = { data: [] };
        let costsData = { data: [] };

        if (allPatientCodes.length > 0) {
            [medicationsData, assessmentsData, plansData, outcomesData, costsData] = await Promise.all([
                supabase
                    .from('medication_history')
                    .select('patient_code, created_at')
                    .in('patient_code', allPatientCodes),

                supabase
                    .from('drn_assessments')
                    .select('patient_code, created_at, category')
                    .in('patient_code', allPatientCodes),

                supabase
                    .from('pharmacy_assistance_plans')
                    .select('patient_code, created_at, plan_type')
                    .in('patient_code', allPatientCodes),

                supabase
                    .from('patient_outcomes')
                    .select('patient_code, created_at, outcome_status')
                    .in('patient_code', allPatientCodes),

                supabase
                    .from('cost_analyses')
                    .select('patient_code, total_costs, cost_savings, created_at')
                    .in('patient_code', allPatientCodes)
            ]);
        }

        // Mock response structure to match previous variable names for downstream logic
        const patientsData = { data: userPatients };

        // Build performance report for each user
        const userPerformance = allUsers.map(user => {
            const userId = user.id;

            // Count patients for this user
            const userPatientsSubset = patientsData.data?.filter(p => p.user_id === userId) || [];
            const patientCodes = userPatientsSubset.map(p => p.patient_code);

            // Count medications for this user's patients
            const userMedications = medicationsData.data?.filter(m =>
                patientCodes.includes(m.patient_code)
            ) || [];

            // Count assessments
            const userAssessments = assessmentsData.data?.filter(a =>
                patientCodes.includes(a.patient_code)
            ) || [];

            // Count plans
            const userPlans = plansData.data?.filter(p =>
                patientCodes.includes(p.patient_code)
            ) || [];

            // Count outcomes
            const userOutcomes = outcomesData.data?.filter(o =>
                patientCodes.includes(o.patient_code)
            ) || [];

            // Calculate total costs managed
            const userCosts = costsData.data?.filter(c =>
                patientCodes.includes(c.patient_code)
            ) || [];
            const totalCostManaged = userCosts.reduce((sum, c) =>
                sum + (parseFloat(c.total_costs) || 0) + (parseFloat(c.cost_savings) || 0), 0);

            // Calculate activity metrics
            const daysSinceJoined = Math.floor(
                (new Date() - new Date(user.created_at || user.joined_at)) / (1000 * 60 * 60 * 24)
            );

            const patientsPerDay = daysSinceJoined > 0 ? (userPatientsSubset.length / daysSinceJoined).toFixed(2) : userPatientsSubset.length;

            // Recent activity (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const recentPatients = userPatientsSubset.filter(p =>
                new Date(p.created_at) >= thirtyDaysAgo
            ).length;

            const recentMedications = userMedications.filter(m =>
                new Date(m.created_at) >= thirtyDaysAgo
            ).length;

            const recentAssessments = userAssessments.filter(a =>
                new Date(a.created_at) >= thirtyDaysAgo
            ).length;

            return {
                user_id: userId,
                email: user?.email || 'N/A',
                full_name: user?.full_name || 'N/A',
                role: user.role,
                joined_at: user.created_at || user.joined_at,
                days_active: Math.max(0, daysSinceJoined),

                // Overall metrics
                total_patients: userPatientsSubset.length,
                total_medications: userMedications.length,
                total_assessments: userAssessments.length,
                total_plans: userPlans.length,
                total_outcomes: userOutcomes.length,
                total_cost_managed: totalCostManaged,

                // Activity rates
                patients_per_day: parseFloat(patientsPerDay),
                avg_medications_per_patient: userPatientsSubset.length > 0
                    ? (userMedications.length / userPatientsSubset.length).toFixed(2)
                    : 0,

                // Recent activity (last 30 days)
                recent_activity: {
                    patients: recentPatients,
                    medications: recentMedications,
                    assessments: recentAssessments
                },

                // Outcome metrics
                outcomes_breakdown: {
                    improved: userOutcomes.filter(o => o.outcome_status === 'Improved').length,
                    stable: userOutcomes.filter(o => o.outcome_status === 'Stable').length,
                    declined: userOutcomes.filter(o => o.outcome_status === 'Declined').length
                }
            };
        });

        // Calculate company-wide summary
        const summary = {
            total_users: allUsers.length,
            total_patients: patientsData.data?.length || 0,
            total_medications: medicationsData.data?.length || 0,
            total_assessments: assessmentsData.data?.length || 0,
            total_plans: plansData.data?.length || 0,
            total_outcomes: outcomesData.data?.length || 0,
            total_cost_managed: costsData.data?.reduce((sum, c) =>
                sum + (parseFloat(c.total_costs) || 0) + (parseFloat(c.cost_savings) || 0), 0) || 0,

            // Top performers
            top_patient_creator: userPerformance.reduce((max, user) =>
                user.total_patients > (max?.total_patients || 0) ? user : max, null
            ),
            top_medication_recorder: userPerformance.reduce((max, user) =>
                user.total_medications > (max?.total_medications || 0) ? user : max, null
            ),
            most_active_last_30_days: userPerformance.reduce((max, user) =>
                (user.recent_activity.patients + user.recent_activity.medications + user.recent_activity.assessments) >
                    ((max?.recent_activity?.patients || 0) + (max?.recent_activity?.medications || 0) + (max?.recent_activity?.assessments || 0))
                    ? user : max, null
            )
        };

        const report = {
            company_id: companyId,
            generated_at: new Date().toISOString(),
            generated_by: userId,
            user_performance: userPerformance.sort((a, b) => b.total_patients - a.total_patients),
            summary
        };

        res.json({ success: true, report });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to generate performance report',
            details: error.message
        });
    }
});

/**
 * Get individual user performance details
 */
router.get('/user-performance/:userId', authenticateToken, async (req, res) => {
    try {
        const requesterId = req.user.userId;
        const requesterRole = req.user.role;
        const companyId = req.user.company_id;
        const targetUserId = req.params.userId;

        // Verify requester is company admin or viewing their own data
        if (requesterRole !== 'company_admin' && requesterRole !== 'admin' && requesterId !== targetUserId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        // Verify target user is in the same company
        const { data: companyUser, error: cuError } = await supabase
            .from('company_users')
            .select('*')
            .eq('user_id', targetUserId)
            .eq('company_id', companyId)
            .single();

        if (cuError || !companyUser) {
            return res.status(404).json({
                success: false,
                error: 'User not found in company'
            });
        }

        // Get detailed performance data
        const { data: patients } = await supabase
            .from('patients')
            .select('*')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false });

        const patientCodes = patients?.map(p => p.patient_code) || [];

        const [medications, assessments, plans, outcomes] = await Promise.all([
            supabase.from('medication_history').select('*').in('patient_code', patientCodes),
            supabase.from('drn_assessments').select('*').in('patient_code', patientCodes),
            supabase.from('pharmacy_assistance_plans').select('*').in('patient_code', patientCodes),
            supabase.from('patient_outcomes').select('*').in('patient_code', patientCodes)
        ]);

        res.json({
            success: true,
            performance: {
                user_id: targetUserId,
                patients: patients || [],
                medications: medications.data || [],
                assessments: assessments.data || [],
                plans: plans.data || [],
                outcomes: outcomes.data || []
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get user performance'
        });
    }
});

export default router;
