import express from 'express';
import bcrypt from 'bcryptjs';
import { supabase, supabaseAdmin } from '../config/supabase.js';
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
            .in('role', ['admin', 'superadmin']);

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

// Update user subscription & plan/role/company status (superadmin)
router.put('/users/:id/subscription', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const userId = req.params.id;
        const {
            subscription_status,
            subscription_plan,
            subscription_end_date,
            account_type,
            company_id,
            role,
            apply_to_company
        } = req.body;

        if (!subscription_status) {
            return res.status(400).json({ success: false, error: 'Subscription status is required' });
        }

        // 1. Fetch user from users or company_users
        let { data: user, error: fetchErr } = await db.from('users').select('*').eq('id', userId).maybeSingle();

        if (!user) {
            const { data: compUser } = await db.from('company_users').select('*').eq('id', userId).maybeSingle();
            if (!compUser) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            user = compUser;
        }

        const now = new Date().toISOString();
        const updates = {
            subscription_status: subscription_status,
            subscription_plan: subscription_plan !== undefined ? subscription_plan : user.subscription_plan,
            subscription_end_date: subscription_end_date !== undefined ? subscription_end_date : user.subscription_end_date,
            updated_at: now
        };

        if (subscription_status === 'active') {
            updates.approved = true;
            updates.email_verified = true;
        }

        // Determine plan category
        const isPlanIndividual = updates.subscription_plan && updates.subscription_plan.startsWith('individual');
        const isTransitionToIndividual = account_type === 'individual' || (isPlanIndividual && account_type !== 'company' && account_type !== 'company_user');

        if (isTransitionToIndividual) {
            // ── INDIVIDUAL TRANSITION ──
            // Fully detach from any company
            updates.company_id = null;
            updates.account_type = 'individual';
            if (user.role !== 'admin' && user.role !== 'superadmin') {
                updates.role = 'user';
            }
            console.log(`🔄 [Subscription] Transitioning user ${userId} (${user.email}) to individual — detaching from company`);

            // Clear any admin_id references in companies table
            await db.from('companies').update({ admin_id: null }).eq('admin_id', userId);
        } else if (account_type === 'company_user') {
            // ── COMPANY USER / EMPLOYEE ──
            updates.account_type = 'company_user';
            if (company_id !== undefined) updates.company_id = company_id || null;
            if (user.role !== 'admin' && user.role !== 'superadmin') {
                updates.role = role || user.role || 'user';
            }
        } else {
            // ── COMPANY / COMPANY ADMIN ──
            updates.account_type = 'company';
            if (user.role !== 'admin' && user.role !== 'superadmin') {
                updates.role = 'company_admin';
            }

            // Find or assign company_id
            let targetCompanyId = (company_id !== undefined ? company_id : user.company_id) || null;
            if (!targetCompanyId && user.email) {
                // Try finding company by admin_email or admin_id
                const { data: compFound } = await db.from('companies')
                    .select('id')
                    .or(`admin_email.ilike.${user.email},admin_id.eq.${userId}`)
                    .maybeSingle();
                if (compFound && compFound.id) {
                    targetCompanyId = compFound.id;
                    console.log(`🏢 [Subscription] Auto-linked user ${userId} to company ${targetCompanyId}`);
                }
            }

            updates.company_id = targetCompanyId;

            // ⚠️ CRITICAL SAFETY: A user with role 'company_admin' but NO company_id will crash on dashboard
            // If no company exists to link to, gracefully revert to 'individual' with role 'user'
            if (!updates.company_id) {
                console.warn(`⚠️ [Subscription] User ${userId} (${user.email}) has no associated company. Setting to individual to prevent lockout.`);
                updates.account_type = 'individual';
                if (user.role !== 'admin' && user.role !== 'superadmin') {
                    updates.role = 'user';
                }
            } else {
                // Ensure this user is marked as admin_id on the company
                await db.from('companies').update({ admin_id: userId, admin_email: user.email }).eq('id', updates.company_id);
            }
        }

        // 2. Update users table
        await db.from('users').update(updates).eq('id', userId);

        // 3. Handle company_users table
        if (isTransitionToIndividual) {
            // REMOVE from company_users entirely by id and email
            await db.from('company_users').delete().eq('id', userId);
            if (user.email) {
                await db.from('company_users').delete().ilike('email', user.email);
            }
            console.log(`✅ [Subscription] Purged user ${userId} (${user.email}) from company_users table`);
        } else {
            // Update company_users table if user exists there
            const compUserUpdates = {
                subscription_status: updates.subscription_status,
                subscription_plan: updates.subscription_plan,
                subscription_end_date: updates.subscription_end_date,
                updated_at: now
            };
            if (updates.company_id !== undefined) compUserUpdates.company_id = updates.company_id;
            if (updates.role) compUserUpdates.role = updates.role;
            if (updates.account_type) compUserUpdates.account_type = updates.account_type;
            if (subscription_status === 'active') {
                compUserUpdates.approved = true;
                compUserUpdates.email_verified = true;
            }
            await db.from('company_users').update(compUserUpdates).eq('id', userId);
        }

        // 4. Cascade to company if requested or if company_admin (skip if going individual)
        const finalCompanyId = isTransitionToIndividual ? null : updates.company_id;
        if (finalCompanyId && (apply_to_company || updates.role === 'company_admin' || updates.account_type === 'company')) {
            await db.from('companies').update({
                subscription_status: updates.subscription_status,
                subscription_plan: updates.subscription_plan,
                subscription_end_date: updates.subscription_end_date,
                updated_at: now
            }).eq('id', finalCompanyId);

            await db.from('users').update({
                subscription_status: updates.subscription_status,
                subscription_plan: updates.subscription_plan,
                subscription_end_date: updates.subscription_end_date
            }).eq('company_id', finalCompanyId);

            await db.from('company_users').update({
                subscription_status: updates.subscription_status,
                subscription_plan: updates.subscription_plan,
                subscription_end_date: updates.subscription_end_date
            }).eq('company_id', finalCompanyId);
        }

        // 5. Insert history into subscriptions table for ledger/audit
        const planName = updates.subscription_plan
            ? updates.subscription_plan.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
            : 'SuperAdmin Custom';

        await db.from('subscriptions').insert([{
            user_id: user.id,
            company_id: finalCompanyId || null,
            plan_id: updates.subscription_plan || 'custom',
            plan_name: planName,
            amount: 0,
            currency: 'ETB',
            status: updates.subscription_status,
            payment_method: 'admin_override',
            start_date: now,
            end_date: updates.subscription_end_date,
            created_at: now
        }]);

        const { data: refreshedUser } = await db.from('users').select('*').eq('id', userId).maybeSingle();

        res.json({
            success: true,
            message: `Subscription successfully updated to ${updates.subscription_status} (${planName})`,
            user: refreshedUser || { ...user, ...updates }
        });
    } catch (e) {
        console.error('❌ Error updating user subscription:', e);
        res.status(500).json({ success: false, error: 'Failed to update subscription', details: e.message });
    }
});

// Update company subscription (superadmin)
router.put('/companies/:id/subscription', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const companyId = req.params.id;
        const {
            subscription_status,
            subscription_plan,
            subscription_end_date
        } = req.body;

        if (!subscription_status) {
            return res.status(400).json({ success: false, error: 'Subscription status is required' });
        }

        const now = new Date().toISOString();
        const updates = {
            subscription_status,
            subscription_plan: subscription_plan || null,
            subscription_end_date: subscription_end_date !== undefined ? subscription_end_date : null,
            updated_at: now
        };

        const { data: company, error: compErr } = await db.from('companies').update(updates).eq('id', companyId).select().single();
        if (compErr) throw compErr;

        // Cascade to company staff in both users & company_users tables
        await db.from('users').update({
            subscription_status,
            subscription_plan: updates.subscription_plan,
            subscription_end_date: updates.subscription_end_date
        }).eq('company_id', companyId);

        await db.from('company_users').update({
            subscription_status,
            subscription_plan: updates.subscription_plan,
            subscription_end_date: updates.subscription_end_date
        }).eq('company_id', companyId);

        // Audit log in subscriptions
        const planName = updates.subscription_plan
            ? updates.subscription_plan.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
            : 'Company Plan';

        await db.from('subscriptions').insert([{
            company_id: companyId,
            plan_id: updates.subscription_plan || 'company_plan',
            plan_name: planName,
            amount: 0,
            currency: 'ETB',
            status: subscription_status,
            payment_method: 'admin_override',
            start_date: now,
            end_date: updates.subscription_end_date,
            created_at: now
        }]);

        res.json({
            success: true,
            message: `Company subscription updated to ${subscription_status} (${planName})`,
            company
        });
    } catch (e) {
        console.error('❌ Error updating company subscription:', e);
        res.status(500).json({ success: false, error: 'Failed to update company subscription', details: e.message });
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

// Subscriptions
router.get('/subscriptions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        if (!db) return res.status(503).json({ success: false, error: 'Database not configured' });

        let { data, error } = await db
            .from('subscriptions')
            .select('*, users(full_name, email), companies(company_name, email)')
            .order('created_at', { ascending: false });

        if (error) {
            // Fallback to simple query if foreign key join fails
            const fallback = await db
                .from('subscriptions')
                .select('*')
                .order('created_at', { ascending: false });

            if (fallback.error) throw fallback.error;
            data = fallback.data || [];

            if (data.length > 0) {
                const userIds = [...new Set(data.map(s => s.user_id).filter(Boolean))];
                const companyIds = [...new Set(data.map(s => s.company_id).filter(Boolean))];

                let userMap = {};
                let companyMap = {};

                if (userIds.length > 0) {
                    const { data: uData } = await db.from('users').select('id, full_name, email').in('id', userIds);
                    if (uData) uData.forEach(u => { userMap[u.id] = u; });
                }
                if (companyIds.length > 0) {
                    const { data: cData } = await db.from('companies').select('id, company_name, email').in('id', companyIds);
                    if (cData) cData.forEach(c => { companyMap[c.id] = c; });
                }

                data = data.map(sub => ({
                    ...sub,
                    users: sub.user_id ? userMap[sub.user_id] : null,
                    companies: sub.company_id ? companyMap[sub.company_id] : null
                }));
            }
        }

        res.json({
            success: true,
            subscriptions: data || []
        });
    } catch (e) {
        console.error('Error fetching admin subscriptions:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch subscriptions', details: e.message });
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

// 💰 Get all referral/promotion data for admin
router.get('/referrals', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;

        // Get all users with promotion codes
        const { data: users, error: usersErr } = await db.from('users')
            .select('id, email, full_name, promotion_code, referred_by_id, created_at')
            .not('promotion_code', 'is', null)
            .order('created_at', { ascending: false });

        if (usersErr) throw usersErr;

        // Get all commissions
        const { data: commissions, error: commErr } = await db.from('commissions')
            .select('*')
            .order('created_at', { ascending: false });

        if (commErr) throw commErr;

        // Build referral stats per user
        const referralStats = (users || []).map(user => {
            // Count how many users used this person's code
            const referredUsers = (users || []).filter(u => u.referred_by_id === user.id);
            // Sum commissions earned
            const userCommissions = (commissions || []).filter(c => c.user_id === user.id);
            const totalEarned = userCommissions.reduce((sum, c) => sum + Number(c.amount), 0);

            return {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                promotion_code: user.promotion_code,
                referrals_count: referredUsers.length,
                total_earned: totalEarned,
                referred_users: referredUsers.map(r => ({
                    id: r.id,
                    email: r.email,
                    full_name: r.full_name,
                    created_at: r.created_at
                })),
                commissions: userCommissions,
                created_at: user.created_at
            };
        });

        // Summary stats
        const totalCommissions = (commissions || []).reduce((sum, c) => sum + Number(c.amount), 0);
        const totalReferrals = (users || []).filter(u => u.referred_by_id).length;

        res.json({
            success: true,
            referral_stats: referralStats,
            summary: {
                total_users_with_codes: users?.length || 0,
                total_referrals: totalReferrals,
                total_commissions_paid: totalCommissions,
                total_commission_records: commissions?.length || 0
            }
        });
    } catch (err) {
        console.error('❌ [Admin/Referrals] error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch referral data' });
    }
});

// ==========================================
// 📢 BROADCAST NOTIFICATIONS
// ==========================================

/**
 * POST /api/admin/broadcasts
 * Create a new broadcast notification sent to all users.
 * Body: { title, message, priority? }
 */
router.post('/broadcasts', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { title, message, priority } = req.body;

        if (!title || !message) {
            return res.status(400).json({ success: false, error: 'Title and message are required' });
        }

        // Insert the broadcast
        const { data: broadcast, error: insertErr } = await db
            .from('broadcasts')
            .insert({
                title: title.trim(),
                message: message.trim(),
                priority: priority || 'normal', // normal, important, urgent
                created_by: req.user.id,
                created_by_name: req.user.full_name || req.user.email
            })
            .select()
            .single();

        if (insertErr) throw insertErr;

        console.log(`📢 [Broadcast] Created: "${title}" by ${req.user.email}`);
        res.json({ success: true, broadcast });
    } catch (error) {
        console.error('❌ [Broadcast/Create] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to create broadcast' });
    }
});

/**
 * GET /api/admin/broadcasts
 * List all broadcasts (admin view — shows all, including read stats).
 */
router.get('/broadcasts', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;

        const { data: broadcasts, error } = await db
            .from('broadcasts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        res.json({ success: true, broadcasts: broadcasts || [] });
    } catch (error) {
        console.error('❌ [Broadcast/List] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch broadcasts' });
    }
});

/**
 * DELETE /api/admin/broadcasts/:id
 * Delete a broadcast.
 */
router.delete('/broadcasts/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { id } = req.params;

        // Delete read records first
        await db.from('broadcast_reads').delete().eq('broadcast_id', id);

        // Delete the broadcast
        const { error } = await db.from('broadcasts').delete().eq('id', id);
        if (error) throw error;

        res.json({ success: true, message: 'Broadcast deleted' });
    } catch (error) {
        console.error('❌ [Broadcast/Delete] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete broadcast' });
    }
});

// ==========================================
// 📬 USER NOTIFICATION ENDPOINTS (non-admin)
// ==========================================

/**
 * GET /api/admin/notifications
 * Get all broadcasts for the currently logged-in user, with read/unread status.
 */
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const userId = req.user.userId;

        // Get all broadcasts
        const { data: broadcasts, error: bErr } = await db
            .from('broadcasts')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (bErr) throw bErr;

        // Get this user's read records
        const { data: reads, error: rErr } = await db
            .from('broadcast_reads')
            .select('broadcast_id')
            .eq('user_id', userId);

        if (rErr) throw rErr;

        const readSet = new Set((reads || []).map(r => r.broadcast_id));

        const notifications = (broadcasts || []).map(b => ({
            ...b,
            is_read: readSet.has(b.id)
        }));

        const unread_count = notifications.filter(n => !n.is_read).length;

        res.json({ success: true, notifications, unread_count });
    } catch (error) {
        console.error('❌ [Notifications/Get] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
    }
});

/**
 * POST /api/admin/notifications/:id/read
 * Mark a single broadcast as read for the current user.
 */
router.post('/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const userId = req.user.userId;
        const broadcastId = req.params.id;

        // Upsert — ignore if already read
        const { error } = await db
            .from('broadcast_reads')
            .upsert(
                { user_id: userId, broadcast_id: broadcastId },
                { onConflict: 'user_id,broadcast_id' }
            );

        if (error) throw error;

        res.json({ success: true, message: 'Marked as read' });
    } catch (error) {
        console.error('❌ [Notifications/Read] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to mark as read' });
    }
});

/**
 * POST /api/admin/notifications/read-all
 * Mark all broadcasts as read for the current user.
 */
router.post('/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const userId = req.user.userId;

        // Get all broadcast IDs
        const { data: broadcasts, error: bErr } = await db
            .from('broadcasts')
            .select('id');

        if (bErr) throw bErr;

        if (broadcasts && broadcasts.length > 0) {
            // Get already-read IDs
            const { data: existing } = await db
                .from('broadcast_reads')
                .select('broadcast_id')
                .eq('user_id', userId);

            const existingSet = new Set((existing || []).map(e => e.broadcast_id));
            const toInsert = broadcasts
                .filter(b => !existingSet.has(b.id))
                .map(b => ({ user_id: userId, broadcast_id: b.id }));

            if (toInsert.length > 0) {
                const { error } = await db.from('broadcast_reads').insert(toInsert);
                if (error) throw error;
            }
        }

        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        console.error('❌ [Notifications/ReadAll] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to mark all as read' });
    }
});

export default router;
