import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { config } from '../config/env.js';
import { debug } from '../utils/logger.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { isValidEmail } from '../utils/helpers.js';

const router = express.Router();

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
        const { data: user } = await supabase.from('users').select('company_id').eq('id', userId).single();
        if (!user || !user.company_id) return res.status(404).json({ error: 'Company not found' });

        const { data: company } = await supabase.from('companies').select('*').eq('id', user.company_id).single();
        res.json({ success: true, company, user_role: req.user.role });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.get('/users', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { data: user } = await supabase.from('users').select('company_id').eq('id', req.user.userId).single();
        if (!user || !user.company_id) return res.status(404).json({ error: 'Company not found' });

        const { data: users } = await supabase.from('company_users').select('*').eq('company_id', user.company_id).order('created_at', { ascending: false });
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

        const { data: admin } = await supabase.from('users').select('company_id').eq('id', req.user.userId).single();
        if (!admin || !admin.company_id) return res.status(404).json({ error: 'Company not found' });

        // Get company's subscription status
        const { data: company } = await supabase.from('companies').select('subscription_status, subscription_plan, subscription_end_date').eq('id', admin.company_id).single();

        const { data: existing } = await supabase.from('company_users').select('id').eq('email', email).eq('company_id', admin.company_id).maybeSingle();
        if (existing) return res.status(400).json({ error: 'Email exists' });

        const hashedPassword = await bcrypt.hash(password.trim(), 10);

        // NEW: Inherit company's subscription status
        const newUser = {
            company_id: admin.company_id,
            email: email.trim().toLowerCase(),
            password_hash: hashedPassword,
            full_name: full_name.trim(),
            phone: phone?.trim() || '',
            role,
            approved: true,
            account_type: 'company_user',
            // Inherit from company
            subscription_status: company?.subscription_status || 'inactive',
            subscription_plan: company?.subscription_plan || null,
            subscription_end_date: company?.subscription_end_date || null,
            license_number: license_number?.trim() || '',
            created_by: req.user.userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase.from('company_users').insert([newUser]).select().single();
        if (error) throw error;

        console.log(`[Company] Created user ${email} with subscription: ${newUser.subscription_status}`);
        res.json({ success: true, message: 'User created', user: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.post('/users/:userId/approve', authenticateToken, requireCompanyAdmin, async (req, res) => {
    // Only needed if we implement approval for company users, but currently they are auto-approved. 
    // Implementation from server.js:
    try {
        const { userId } = req.params;
        const { data: admin } = await supabase.from('users').select('company_id').eq('id', req.user.userId).single();
        if (!admin) return res.status(404).json({ error: 'Company not found' });

        // Assuming users table here based on original code, OR company_users. 
        // Original code line 6346 queries 'users' table. 
        // But company users created above are in 'company_users'.
        // The original code seems to mix up 'users' and 'company_users' or handles both.
        // Given the context of "Company Users" feature recently added, it should probably target company_users.
        // However line 6347 selects from 'users'. 
        // Let's stick to what the original code did: query 'users'.

        const { data: target } = await supabase.from('users').select('company_id').eq('id', userId).single();
        if (!target) return res.status(404).json({ error: 'User not found' });
        if (target.company_id !== admin.company_id) return res.status(403).json({ error: 'Different company' });

        await supabase.from('users').update({ approved: true, updated_at: new Date().toISOString() }).eq('id', userId);
        res.json({ success: true, message: 'Approved' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.put('/users/:userId', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { full_name, phone, role, license_number, status } = req.body;
        const { data: admin } = await supabase.from('users').select('company_id').eq('id', req.user.userId).single();

        const updates = { updated_at: new Date().toISOString() };
        if (full_name) updates.full_name = full_name;
        if (phone) updates.phone = phone;
        if (role) updates.role = role;
        if (license_number) updates.license_number = license_number;
        if (status) updates.status = status;

        const { error } = await supabase.from('company_users').update(updates).eq('id', userId).eq('company_id', admin.company_id);
        if (error) throw error;
        res.json({ success: true, message: 'Updated' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.delete('/users/:userId', authenticateToken, requireCompanyAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { data: admin } = await supabase.from('users').select('company_id').eq('id', req.user.userId).single();
        const { error } = await supabase.from('company_users').delete().eq('id', userId).eq('company_id', admin.company_id);
        if (error) throw error;
        res.json({ success: true, message: 'Deleted' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Auth Routes for Company Users
router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

        const { data: user } = await supabase.from('company_users').select('*').eq('email', email.toLowerCase()).maybeSingle();
        if (!user || !user.approved) return res.status(401).json({ error: 'Invalid or pending approval' });

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

        const { data: user } = await supabase.from('company_users').select('*').eq('id', req.user.userId).single();
        if (!user) return res.status(404).json({ error: 'Not found' });

        const { data: company } = await supabase.from('companies').select('*').eq('id', user.company_id).single();

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

        const { data, error } = await supabase.from('company_users').update(updates).eq('id', req.user.userId).select().single();
        if (error) throw error;

        res.json({ success: true, message: 'Updated', user: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
