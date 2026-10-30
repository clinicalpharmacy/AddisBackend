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

// ==========================================
// 💬 CHAT MANAGEMENT (Admin)
// ==========================================

/**
 * GET /api/admin/chat/sessions
 * List all chat sessions with last message + unread count for admin.
 */
router.get('/chat/sessions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;

        const { data: sessions, error } = await db
            .from('chat_sessions')
            .select('*')
            .order('last_message_at', { ascending: false, nullsFirst: false })
            .limit(200);

        if (error) throw error;

        if (!sessions || sessions.length === 0) {
            return res.json({ success: true, sessions: [], count: 0 });
        }

        const sessionIds = sessions.map(s => s.id);

        // Fetch all messages for those sessions in one query
        const { data: messages, error: mErr } = await db
            .from('chat_messages')
            .select('*')
            .in('session_id', sessionIds)
            .order('created_at', { ascending: true });

        if (mErr) throw mErr;

        // Group messages by session
        const bySession = {};
        (messages || []).forEach(m => {
            if (!bySession[m.session_id]) bySession[m.session_id] = [];
            bySession[m.session_id].push(m);
        });

        const enriched = sessions.map(s => {
            const msgs = bySession[s.id] || [];
            const lastMessage = msgs[msgs.length - 1] || null;
            const adminLastRead = s.admin_read_at ? new Date(s.admin_read_at) : new Date(0);

            const unreadCount = msgs.filter(
                m => m.sender === 'user' && new Date(m.created_at) > adminLastRead
            ).length;

            return {
                ...s,
                last_message: lastMessage,
                unread_count: unreadCount,
                total_messages: msgs.length
            };
        });

        res.json({ success: true, sessions: enriched, count: enriched.length });
    } catch (error) {
        console.error('❌ [Admin/Chat/ListSessions] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch chat sessions' });
    }
});

/**
 * GET /api/admin/chat/sessions/:id/messages
 * Fetch messages of one session; also marks the session read for admin.
 */
router.get('/chat/sessions/:id/messages', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const sessionId = req.params.id;

        const { data: session, error: sErr } = await db
            .from('chat_sessions')
            .select('*')
            .eq('id', sessionId)
            .maybeSingle();

        if (sErr) throw sErr;
        if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

        const { data: messages, error: mErr } = await db
            .from('chat_messages')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });

        if (mErr) throw mErr;

        // Mark as read by admin (silent update)
        await db.from('chat_sessions')
            .update({ admin_read_at: new Date().toISOString() })
            .eq('id', sessionId);

        res.json({ success: true, session, messages: messages || [] });
    } catch (error) {
        console.error('❌ [Admin/Chat/GetMessages] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch messages' });
    }
});

/**
 * POST /api/admin/chat/sessions/:id/messages
 * Admin sends a reply.
 * Body: { content }
 */
router.post('/chat/sessions/:id/messages', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const sessionId = req.params.id;
        const { content } = req.body;

        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, error: 'Message content is required' });
        }

        const { data: session } = await db
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .maybeSingle();

        if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

        const { data: message, error } = await db
            .from('chat_messages')
            .insert({
                session_id: sessionId,
                sender: 'admin',
                content: content.trim()
            })
            .select()
            .single();

        if (error) throw error;

        const now = new Date().toISOString();
        await db.from('chat_sessions')
            .update({ last_message_at: now, updated_at: now, admin_read_at: now })
            .eq('id', sessionId);

        res.json({ success: true, message });
    } catch (error) {
        console.error('❌ [Admin/Chat/SendMessage] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to send message' });
    }
});

/**
 * POST /api/admin/chat/sessions/:id/read
 * Mark a session as read for admin.
 */
router.post('/chat/sessions/:id/read', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const { error } = await db.from('chat_sessions')
            .update({ admin_read_at: new Date().toISOString() })
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ success: true, message: 'Marked as read' });
    } catch (error) {
        console.error('❌ [Admin/Chat/MarkRead] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to mark as read' });
    }
});

/**
 * DELETE /api/admin/chat/sessions/:id
 * Delete a session and its messages.
 */
router.delete('/chat/sessions/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;
        const sessionId = req.params.id;

        await db.from('chat_messages').delete().eq('session_id', sessionId);
        const { error } = await db.from('chat_sessions').delete().eq('id', sessionId);
        if (error) throw error;

        res.json({ success: true, message: 'Session deleted' });
    } catch (error) {
        console.error('❌ [Admin/Chat/DeleteSession] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete session' });
    }
});

/**
 * GET /api/admin/chat/stats
 * Unread badge counts for the admin sidebar.
 */
router.get('/chat/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const db = supabaseAdmin || supabase;

        const { data: sessions, error } = await db
            .from('chat_sessions')
            .select('id, admin_read_at');
        if (error) throw error;

        if (!sessions || sessions.length === 0) {
            return res.json({
                success: true,
                stats: { total_sessions: 0, unread_sessions: 0, unread_messages: 0 }
            });
        }

        const sessionIds = sessions.map(s => s.id);

        const { data: userMessages, error: mErr } = await db
            .from('chat_messages')
            .select('session_id, created_at')
            .in('session_id', sessionIds)
            .eq('sender', 'user');

        if (mErr) throw mErr;

        const sessionMap = sessions.reduce((acc, s) => ({ ...acc, [s.id]: s }), {});
        let unreadMessages = 0;
        const unreadSessionSet = new Set();

        (userMessages || []).forEach(m => {
            const s = sessionMap[m.session_id];
            if (!s) return;
            const last = s.admin_read_at ? new Date(s.admin_read_at) : new Date(0);
            if (new Date(m.created_at) > last) {
                unreadMessages++;
                unreadSessionSet.add(m.session_id);
            }
        });

        res.json({
            success: true,
            stats: {
                total_sessions: sessions.length,
                unread_sessions: unreadSessionSet.size,
                unread_messages: unreadMessages
            }
        });
    } catch (error) {
        console.error('❌ [Admin/Chat/Stats] error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch chat stats' });
    }
});

export default router;
