import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/env.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { isValidEmail } from '../utils/helpers.js';

const router = express.Router();
const db = supabaseAdmin || supabase;

// --- User limits (mirrors src/utils/userLimits.js) ---
const USER_LIMITS = {
    pharmacy:        { monthly: 3,  yearly: 5  },
    clinic:          { monthly: 3,  yearly: 5  },
    hospital:        { monthly: 10, yearly: 10 },
    pharmacy_school: { monthly: 10, yearly: 10 },
    other_company:   { monthly: 3,  yearly: 5  },
};

// Signup / DB aliases → canonical keys in USER_LIMITS
const COMPANY_TYPE_ALIASES = {
    pharmacy: 'pharmacy',
    'pharmacy/drug store': 'pharmacy',
    'drug store': 'pharmacy',
    clinic: 'clinic',
    'clinic/specialty center/health center': 'clinic',
    hospital: 'hospital',
    pharmacy_school: 'pharmacy_school',
    pharmaceutical: 'pharmacy_school',      // what Signup.jsx sends for Pharmacy School
    'pharmacy school': 'pharmacy_school',
    other_company: 'other_company',
};

const normalizeCompanyType = (raw) => {
    if (!raw) return '';
    const key = String(raw).toLowerCase().trim();
    return COMPANY_TYPE_ALIASES[key] || key.replace(/\s+/g, '_');
};

/**
 * Accepts EITHER:
 *   - a billing interval: 'monthly' | 'yearly'
 *   - a plan id:          'pharmacy_monthly', 'clinic_yearly', ...
 *   - a plan name:        'Pharmacy / Drug Store Monthly'
 */
const normalizePlanInterval = (raw) => {
    if (!raw) return 'monthly';
    const s = String(raw).toLowerCase().trim();
    if (s.includes('yearly') || s.includes('annual') || s === 'year') return 'yearly';
    if (s.includes('monthly') || s === 'month') return 'monthly';
    return 'monthly'; // safe default
};

const getMaxUsers = (companyType, plan) => {
    const type = normalizeCompanyType(companyType);
    const interval = normalizePlanInterval(plan);
    const limits = USER_LIMITS[type];
    if (!limits) return 0;
    return limits[interval];
};

// Middleware to ensure company admin
const requireCompanyAdmin = (req, res, next) => {
    if (req.user.role !== 'company_admin' && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Company admin access required' });
    }
    next();
};

router.get('/info', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { data: user } = await db.from('users').select('company_id').eq('id', userId).single();
        if (!user || !user.company_id) return res.status(404).json({ error: 'Company not found' });

        const { data: company } = await db.from('companies').select('*').eq('id', user.company_id).single();
        res.json({ success: true, company, user_role: req.user.role });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.get('/users', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { data: user } = await db.from('users').select('company_id').eq('id', req.user.userId).single();
        if (!user || !user.company_id) return res.status(404).json({ error: 'Company not found' });

        const { data: users } = await db.from('company_users').select('*').eq('company_id', user.company_id).order('created_at', { ascending: false });
        res.json({ success: true, users: users || [], count: users?.length || 0, company_id: user.company_id });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.post('/users', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { email, password, full_name, phone, role = 'company_user', license_number } = req.body;
        if (!email || !password || !full_name) return res.status(400).json({ error: 'Missing fields' });
        if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });

        const cleanEmail = email.trim().toLowerCase();

        const { data: admin } = await db.from('users').select('company_id').eq('id', req.user.userId).single();
        if (!admin || !admin.company_id) return res.status(404).json({ error: 'Company not found' });

        // Get company's subscription status
        let { data: company } = await db.from('companies').select('*').eq('id', admin.company_id).single();
        let isCompanyActive = company?.subscription_status === 'active';

        // Backup check in subscriptions table
        if (!isCompanyActive) {
            const { data: activeSub } = await db.from('subscriptions')
                .select('*')
                .eq('company_id', admin.company_id)
                .eq('status', 'active')
                .gt('end_date', new Date().toISOString())
                .order('end_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (activeSub) {
                isCompanyActive = true;
                company = company || {};
                company.subscription_status = 'active';
                company.subscription_plan = activeSub.plan_id;
                company.subscription_end_date = activeSub.end_date;
            }
        }

        // --- USER LIMIT CHECK (authoritative) ---
        const companyType = company?.company_type || company?.type;

        // Prefer the active subscription's plan_id as the source of truth,
        // because `companies.subscription_plan` may be null or a bare interval.
        let rawPlan = company?.subscription_plan || company?.plan || '';

        if (!rawPlan || !normalizeCompanyType(companyType)) {
            const { data: activeSub } = await db
                .from('subscriptions')
                .select('plan_id, status, end_date')
                .eq('company_id', admin.company_id)
                .eq('status', 'active')
                .gt('end_date', new Date().toISOString())
                .order('end_date', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (activeSub?.plan_id) rawPlan = activeSub.plan_id;
        }

        const maxUsers = getMaxUsers(companyType, rawPlan);

        const { count: currentCount, error: countErr } = await db
            .from('company_users')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', admin.company_id);

        if (countErr) throw countErr;

        if (maxUsers === 0) {
            return res.status(403).json({
                success: false,
                error: `Your company type ("${companyType || 'unknown'}") or plan ("${rawPlan || 'unknown'}") is not recognized. Please contact support.`,
                company_type: companyType,
                plan: rawPlan,
            });
        }

        if ((currentCount || 0) >= maxUsers) {
            return res.status(403).json({
                success: false,
                error: `User limit reached: your ${rawPlan || 'monthly'} plan allows a maximum of ${maxUsers} user(s).`,
                limit: maxUsers,
                current: currentCount || 0,
                company_type: companyType,
                plan: rawPlan,
            });
        }

        const { data: existingInComp } = await db.from('company_users').select('id').eq('email', cleanEmail).eq('company_id', admin.company_id).maybeSingle();
        if (existingInComp) return res.status(400).json({ error: 'This user is already added to your company' });

        const hashedPassword = await bcrypt.hash(password.trim(), 10);

        // Check if user already exists in the regular users table
        const { data: existingUser } = await db.from('users').select('*').eq('email', cleanEmail).maybeSingle();

        const subStatus = isCompanyActive ? 'active' : (company?.subscription_status || 'inactive');
        const subPlan = isCompanyActive ? (company?.subscription_plan || null) : null;
        const subEndDate = isCompanyActive ? (company?.subscription_end_date || null) : null;

        const newUser = {
            ...(existingUser?.id ? { id: existingUser.id } : {}),
            company_id: admin.company_id,
            email: cleanEmail,
            password_hash: hashedPassword,
            full_name: full_name.trim(),
            phone: phone?.trim() || '',
            role,
            approved: true,
            email_verified: true,
            account_type: 'company_user',
            subscription_status: subStatus,
            subscription_plan: subPlan,
            subscription_end_date: subEndDate,
            license_number: license_number?.trim() || '',
            created_by: req.user.userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: createdCompUser, error: insertError } = await db.from('company_users').insert([newUser]).select().single();
        if (insertError) throw insertError;

        // Also sync or create in regular 'users' table for foreign key integrity
        const targetUserId = createdCompUser.id;
        if (existingUser) {
            await db.from('users').update({
                company_id: admin.company_id,
                account_type: 'company_user',
                role,
                full_name: full_name.trim(),
                phone: phone?.trim() || existingUser.phone,
                approved: true,
                email_verified: true,
                password_hash: hashedPassword,
                subscription_status: subStatus,
                subscription_plan: subPlan,
                subscription_end_date: subEndDate,
                updated_at: new Date().toISOString()
            }).eq('id', existingUser.id);
        } else {
            await db.from('users').insert([{
                id: targetUserId,
                email: cleanEmail,
                full_name: full_name.trim(),
                phone: phone?.trim() || '',
                role,
                company_id: admin.company_id,
                account_type: 'company_user',
                approved: true,
                email_verified: true,
                password_hash: hashedPassword,
                subscription_status: subStatus,
                subscription_plan: subPlan,
                subscription_end_date: subEndDate,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }]);
        }

        res.json({ success: true, message: 'User created', user: createdCompUser });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/users/:userId/approve', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: admin } = await db.from('users').select('company_id').eq('id', req.user.userId).single();
        if (!admin) return res.status(404).json({ error: 'Company not found' });

        const { data: target } = await db.from('company_users').select('company_id').eq('id', userId).maybeSingle();
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.company_id !== admin.company_id) return res.status(403).json({ error: 'Different company' });

        await db.from('company_users').update({ approved: true, email_verified: true, updated_at: new Date().toISOString() }).eq('id', userId);
        await db.from('users').update({ approved: true, email_verified: true, updated_at: new Date().toISOString() }).eq('id', userId);

        res.json({ success: true, message: 'Approved' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/users/:userId', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { full_name, phone, role, license_number, status } = req.body;
        const { data: admin } = await db.from('users').select('company_id').eq('id', req.user.userId).single();

        const updates = { updated_at: new Date().toISOString() };
        if (full_name) updates.full_name = full_name;
        if (phone) updates.phone = phone;
        if (role) updates.role = role;
        if (license_number) updates.license_number = license_number;
        if (status) updates.status = status;

        const { error } = await db.from('company_users').update(updates).eq('id', userId).eq('company_id', admin.company_id);
        if (error) throw error;

        // Sync with users table as well
        const userUpdates = { updated_at: new Date().toISOString() };
        if (full_name) userUpdates.full_name = full_name;
        if (phone) userUpdates.phone = phone;
        if (role) userUpdates.role = role;
        await db.from('users').update(userUpdates).eq('id', userId).eq('company_id', admin.company_id);

        res.json({ success: true, message: 'Updated' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/users/:userId', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: admin } = await db.from('users').select('company_id').eq('id', req.user.userId).single();
        const { error } = await db.from('company_users').delete().eq('id', userId).eq('company_id', admin.company_id);
        if (error) throw error;

        await db.from('users').delete().eq('id', userId).eq('company_id', admin.company_id).eq('account_type', 'company_user');

        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/users/:userId/toggle-block', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: admin } = await db.from('users').select('company_id').eq('id', req.user.userId).single();
        if (!admin) return res.status(404).json({ error: 'Company not found' });

        const { data: user } = await db.from('company_users').select('is_blocked, blocked_by, company_id').eq('id', userId).single();
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.company_id !== admin.company_id) return res.status(403).json({ error: 'Not authorized for this user' });

        if (user.is_blocked && user.blocked_by === 'superadmin') {
            return res.status(403).json({
                success: false,
                error: 'This user was blocked by a System Administrator. Only a System Administrator can unblock them.'
            });
        }

        const newStatus = !user.is_blocked;
        const { error } = await db.from('company_users')
            .update({
                is_blocked: newStatus,
                blocked_by: newStatus ? 'company_admin' : null,
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) throw error;

        await db.from('users').update({
            is_blocked: newStatus,
            blocked_by: newStatus ? 'company_admin' : null
        }).eq('id', userId);

        res.json({
            success: true,
            message: newStatus ? 'User blocked' : 'User unblocked',
            is_blocked: newStatus
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Auth Routes for Company Users
router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

        const { data: user } = await db.from('company_users').select('*').eq('email', email.toLowerCase()).maybeSingle();
        if (!user || !user.approved) return res.status(401).json({ error: 'Invalid or pending approval' });

        if (user.is_blocked) {
            return res.status(403).json({ error: 'Your account has been blocked. Please contact your administrator.' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({
            userId: user.id,
            email: user.email,
            role: user.role,
            account_type: 'company_user',
            company_id: user.company_id,
            approved: user.approved
        }, config.jwtSecret, { expiresIn: '24h' });

        res.json({ success: true, token, user, login_type: 'company_user' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

router.get('/auth/me', authenticateToken, async (req, res) => {
    try {
        if (req.user.account_type !== 'company_user') return res.status(403).json({ error: 'Not company user' });

        const { data: user } = await db.from('company_users').select('*').eq('id', req.user.userId).single();
        if (!user) return res.status(404).json({ error: 'Not found' });

        const { data: company } = await db.from('companies').select('*').eq('id', user.company_id).single();

        res.json({ success: true, user: { ...user, company_name: company?.company_name } });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.put('/auth/update-profile', authenticateToken, async (req, res) => {
    try {
        if (req.user.account_type !== 'company_user') return res.status(403).json({ error: 'Not company user' });

        const updates = { ...req.body, updated_at: new Date().toISOString() };
        ['id', 'email', 'company_id', 'approved', 'account_type', 'created_at', 'password_hash', 'created_by'].forEach(k => delete updates[k]);

        const { data, error } = await db.from('company_users').update(updates).eq('id', req.user.userId).select().single();
        if (error) throw error;

        res.json({ success: true, message: 'Updated', user: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
