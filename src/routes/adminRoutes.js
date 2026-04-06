import express from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * 🔒 GET SECURITY USERS (Public to authenticated users)
 * Returns all admins who have initialized their security keys.
 */
router.get('/security-users', authenticateToken, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { data: users, error } = await db
            .from('users')
            .select('id, full_name, email, public_key')
            .eq('role', 'admin')
            .not('public_key', 'is', null);

        if (error) throw error;
        res.json({ success: true, users: users || [] });
    } catch (error) {
        console.error('❌ [Admin/SecurityUsers] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch security users' });
    }
});

// Get pending approvals
router.get('/pending-approvals', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: pendingUsers, error } = await supabase
            .from('users')
            .select('id, email, full_name, institution, country, region, phone, account_type, role, approved, created_at, subscription_status, license_number')
            .eq('approved', false)
            .eq('role', 'company_admin') // ONLY Company Admins need manual approval
            .order('created_at', { ascending: true });

        if (error) throw error;
        res.json({ success: true, users: pendingUsers || [], count: pendingUsers?.length || 0 });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch pending approvals', details: error.message });
    }
});

// Get all users
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: users, error } = await supabase
            .from('users')
            .select('id, email, full_name, role, account_type, approved, institution, company_id, subscription_status, subscription_plan, subscription_end_date, created_at, phone, country, region, license_number, is_blocked, blocked_by')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ success: true, users: users || [], count: users?.length || 0 });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to fetch users', details: error.message });
    }
});

// Get user by ID
router.get('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: user, error } = await supabase.from('users').select('*').eq('id', userId).single();
        if (error || !user) return res.status(404).json({ success: false, error: 'User not found' });

        let company = null;
        if (user.company_id) {
            const { data } = await supabase.from('companies').select('*').eq('id', user.company_id).single();
            company = data;
        }

        let subscription = null;
        const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        subscription = sub;

        res.json({ success: true, user, company, subscription, has_company: !!user.company_id, has_active_subscription: subscription?.status === 'active' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Approve user
router.post('/users/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        if (user.approved) return res.json({ success: true, message: 'Already approved', user });

        const { error } = await supabase.from('users').update({ approved: true, updated_at: new Date().toISOString() }).eq('id', user.id);
        if (error) throw error;

        const { data: updatedUser } = await supabase.from('users').select('*').eq('id', user.id).single();
        res.json({ success: true, message: 'User approved', user: updatedUser });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to approve' });
    }
});

// Bulk approve
router.post('/users/bulk-approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { userIds } = req.body;
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });
        if (!userIds?.length) return res.status(400).json({ error: 'User IDs required' });

        const { error } = await supabase.from('users').update({ approved: true, updated_at: new Date().toISOString() }).in('id', userIds);
        if (error) throw error;

        const { data: updatedUsers } = await supabase.from('users').select('id, email, full_name').in('id', userIds);
        res.json({ success: true, message: 'Approved users', users: updatedUsers });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Reject user
router.delete('/users/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
        if (!user) return res.status(404).json({ error: 'User not found' });

        const { error } = await supabase.from('users').delete().eq('id', userId);
        if (error) throw error;

        res.json({ success: true, message: 'User rejected', user: { email: user.email } });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Update user (admin)
router.put('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        const updates = { ...req.body };
        ['id', 'created_at', 'password_hash'].forEach(k => delete updates[k]);
        updates.updated_at = new Date().toISOString();

        if (updates.password) {
            updates.password_hash = await bcrypt.hash(updates.password, 10);
            delete updates.password;
        }

        const { data: user, error } = await supabase.from('users').update(updates).eq('id', userId).select().single();
        if (error) throw error;

        res.json({ success: true, message: 'User updated', user });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Toggle block user (superadmin)
router.post('/users/:id/toggle-block', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const userId = req.params.id;
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        // Check users table
        const { data: user, error: fetchError } = await supabase.from('users').select('is_blocked, email').eq('id', userId).maybeSingle();

        // If not in users, check company_users
        let targetTable = 'users';
        let currentStatus = user?.is_blocked;
        let email = user?.email;

        if (!user) {
            const { data: cUser } = await supabase.from('company_users').select('is_blocked, email').eq('id', userId).maybeSingle();
            if (!cUser) return res.status(404).json({ success: false, error: 'User not found in any table' });
            targetTable = 'company_users';
            currentStatus = cUser.is_blocked;
            email = cUser.email;
        }

        const newStatus = !currentStatus;

        // Update the primary table
        const { error: updateError } = await supabase.from(targetTable).update({
            is_blocked: newStatus,
            blocked_by: newStatus ? 'superadmin' : null,
            updated_at: new Date().toISOString()
        }).eq('id', userId);

        if (updateError) throw updateError;

        // Sync with the other table if the user exists there too
        const otherTable = targetTable === 'users' ? 'company_users' : 'users';
        await supabase.from(otherTable).update({
            is_blocked: newStatus,
            blocked_by: newStatus ? 'superadmin' : null
        }).eq('id', userId);

        res.json({
            success: true,
            message: newStatus ? `User ${email} blocked` : `User ${email} unblocked`,
            is_blocked: newStatus,
            blocked_by: newStatus ? 'superadmin' : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to toggle block status', details: error.message });
    }
});

// Stats
router.get('/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const [users, companies, pending, subs, payments, meds, doctors, nurses, pharmacists, students, labs, others, blocked, clients] = await Promise.all([
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('companies').select('*', { count: 'exact', head: true }),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('approved', false).eq('role', 'company_admin'),
            supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
            supabase.from('payments').select('amount').eq('status', 'paid'),
            supabase.from('medications').select('*', { count: 'exact', head: true }),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'doctor'),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'nurse'),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'pharmacist'),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'student'),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'laboratory'),
            supabase.from('users').select('*', { count: 'exact', head: true }).in('role', ['other_health_professional', 'health_officer']),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_blocked', true),
            supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'healthcare_client')
        ]);

        const total_revenue = payments.data?.reduce((s, p) => s + (p.amount || 0), 0) || 0;

        // Growth
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const { count: user_growth } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo.toISOString());

        res.json({
            success: true,
            stats: {
                total_users: users.count || 0,
                total_companies: companies.count || 0,
                pending_approvals: pending.count || 0,
                active_subscriptions: subs.count || 0,
                total_revenue,
                total_medications: meds.count || 0,
                blocked_users: blocked.count || 0,
                user_growth: user_growth || 0,
                doctor_count: doctors.count || 0,
                nurse_count: nurses.count || 0,
                pharmacist_count: pharmacists.count || 0,
                student_count: students.count || 0,
                laboratory_count: labs.count || 0,
                others_count: others.count || 0,
                healthcare_client_count: clients.count || 0
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Companies
router.get('/companies', authenticateToken, requireAdmin, async (req, res) => {
    try {
        let { data, error } = await supabase
            .from('companies')
            .select('*, users!admin_id(full_name, email, phone)')
            .order('created_at', { ascending: false });

        if (error) {
            const fallback = await supabase
                .from('companies')
                .select('*, users(full_name, email, phone)')
                .order('created_at', { ascending: false });

            if (fallback.error) {
                const simple = await supabase
                    .from('companies')
                    .select('*')
                    .order('created_at', { ascending: false });

                if (simple.error) throw simple.error;
                data = simple.data;
            } else {
                data = fallback.data;
            }
        }

        res.json({
            success: true,
            companies: data || [],
            count: data?.length || 0
        });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Internal Server Error', details: e.message });
    }
});

router.get('/companies/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: company } = await supabase.from('companies').select('*').eq('id', req.params.id).single();
        if (!company) return res.status(404).json({ error: 'Not found' });

        let admin = null;
        if (company.admin_id) {
            const { data } = await supabase.from('users').select('*').eq('id', company.admin_id).single();
            admin = data;
        }
        const { data: users } = await supabase.from('users').select('*').eq('company_id', company.id);

        res.json({ success: true, company, admin, users: users || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.post('/companies/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const companyId = req.params.id;
        const { data: company } = await supabase.from('companies').select('*').eq('id', companyId).single();
        if (!company) return res.status(404).json({ error: 'Company not found' });

        const { data: admin } = await supabase.from('users').select('*').eq('company_id', companyId).eq('role', 'company_admin').single();
        if (!admin) return res.status(404).json({ error: 'Company admin not found' });

        await supabase.from('users').update({ approved: true, updated_at: new Date().toISOString() }).eq('id', admin.id);
        await supabase.from('companies').update({ updated_at: new Date().toISOString() }).eq('id', companyId);

        res.json({ success: true, message: 'Company approved', company });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Recent Activities
router.get('/recent-activities', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: recentUsers } = await supabase
            .from('users')
            .select('full_name, email, created_at, role, approved')
            .order('created_at', { ascending: false })
            .limit(10);

        const activities = recentUsers?.map(user => ({
            id: user.id || Math.random(),
            user_name: user.full_name,
            action_type: user.approved ? 'user_approved' : 'user_registered',
            description: user.approved ? `User ${user.email} was approved` : `New user ${user.email} registered`,
            created_at: user.created_at
        })) || [];

        res.json({ success: true, activities });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed to fetch activities' });
    }
});

// Admin Payments
router.get('/payments', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data } = await supabase.from('payments').select('*, users(full_name, email)').order('created_at', { ascending: false }).limit(100);
        const total = data?.reduce((s, p) => s + (p.amount || 0), 0) || 0;
        res.json({ success: true, payments: data || [], total_revenue: total });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

// Admin Subscriptions
router.get('/subscriptions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        // Fetch subscriptions, users, and companies independently to avoid join errors if relationships aren't formal
        const [subsResult, usersResult, compsResult] = await Promise.all([
            supabase.from('subscriptions').select('*').order('created_at', { ascending: false }).limit(400),
            supabase.from('users').select('id, full_name, email, institution'),
            supabase.from('companies').select('id, company_name, email')
        ]);

        if (subsResult.error) throw subsResult.error;

        // Manual merge to provide names even if DB schema lacks relationships
        const usersMap = (usersResult.data || []).reduce((acc, user) => ({ ...acc, [user.id]: user }), {});
        const compsMap = (compsResult.data || []).reduce((acc, comp) => ({ ...acc, [comp.id]: comp }), {});

        const mergedData = (subsResult.data || []).map(sub => ({
            ...sub,
            users: usersMap[sub.user_id] || null,
            companies: compsMap[sub.company_id] || null
        }));

        res.json({ success: true, subscriptions: mergedData, count: mergedData.length });
    } catch (e) {
        console.error('❌ Error fetching subscriptions:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch subscriptions', details: e.message });
    }
});


export default router;
