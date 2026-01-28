import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { config } from '../config/env.js';
import { debug } from '../utils/logger.js';
import { isValidEmail } from '../utils/helpers.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();
const JWT_SECRET = config.jwtSecret;

// User Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔐 LOGIN ATTEMPT:', { email, passwordLength: password?.length });

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const cleanEmail = email.trim().toLowerCase();
        const cleanPassword = password.trim();
        let user = null;
        let userType = null;
        let fetchError = null;

        const { data: regularUser, error: regularError } = await supabase.from('users').select('*').eq('email', cleanEmail).maybeSingle();

        if (regularUser) {
            user = regularUser;
            userType = 'regular_user';
        } else {
            const { data: companyUser, error: companyError } = await supabase.from('company_users').select('*').eq('email', cleanEmail).maybeSingle();
            if (companyUser) {
                user = companyUser;
                userType = 'company_user';
            } else {
                fetchError = regularError; // Default error to regular
            }
        }

        if (fetchError) return res.status(500).json({ success: false, error: 'Database error' });
        if (!user) return res.status(401).json({ success: false, error: 'Invalid email or password' });

        let validPassword = false;
        if (user.password_hash) {
            validPassword = await bcrypt.compare(cleanPassword, user.password_hash);
        }
        if (!validPassword) return res.status(401).json({ success: false, error: 'Invalid email or password' });

        if (user.role !== 'admin' && !user.approved) {
            return res.status(401).json({
                success: false,
                error: 'Your account is pending approval. Please wait for approval before logging in.',
                approval_required: true
            });
        }

        const tokenPayload = {
            userId: user.id,
            email: user.email,
            name: user.full_name,
            role: user.role,
            approved: user.approved,
            account_type: userType === 'company_user' ? 'company_user' : (user.account_type || 'individual'),
            user_type: userType
        };
        if (user.company_id) tokenPayload.company_id = user.company_id;

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        let companyData = null;
        let companyId = user.company_id;

        if (!companyId) {
            const { data: employeeRecord } = await supabase
                .from('company_users')
                .select('company_id')
                .ilike('email', cleanEmail)
                .maybeSingle();

            if (employeeRecord && employeeRecord.company_id) {
                companyId = employeeRecord.company_id;
            }
        }

        if (companyId) {
            const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
            companyData = data;
        }

        let hasCompanySubscription = companyData && companyData.subscription_status === 'active';

        // NEW: Backup check in subscriptions history if company record is out of sync
        if (companyId && !hasCompanySubscription) {
            const { data: activeSub } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('company_id', companyId)
                .eq('status', 'active')
                .gt('end_date', new Date().toISOString())
                .order('end_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (activeSub) {
                console.log(`[Auth] Login recovery: Active subscription found for company ${companyId}`);
                hasCompanySubscription = true;
                companyData = companyData || { id: companyId };
                companyData.subscription_status = 'active';
                companyData.subscription_plan = activeSub.plan_id;
                companyData.subscription_end_date = activeSub.end_date;
            }
        }

        const isEffectivelyCompanyUser = userType === 'company_user' || !!companyId;

        console.log(`[Auth] Login for ${user.email}:`, {
            userType,
            companyId,
            hasCompanySubscription,
            companyStatus: companyData?.subscription_status,
            userSubscriptionStatus: user.subscription_status,
            isEffectivelyCompanyUser
        });

        const userResponse = {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            approved: user.approved,
            account_type: isEffectivelyCompanyUser ? 'company_user' : (user.account_type || 'individual'),
            institution: user.institution || (companyData ? companyData.company_name : ''),
            company_id: companyId,
            company: companyData,
            subscription_status: hasCompanySubscription ? 'active' : (user.subscription_status || 'inactive'),
            subscription_plan: hasCompanySubscription ? companyData.subscription_plan : (user.subscription_plan || null),
            subscription_end_date: hasCompanySubscription ? companyData.subscription_end_date : user.subscription_end_date,
            created_at: user.created_at,
            phone: user.phone,
            country: user.country,
            region: user.region,
            tin_number: user.tin_number || '',
            license_number: user.license_number || ''
        };

        console.log(`[Auth] Login successful for ${user.email}. CompanyId: ${companyId}, Sub: ${userResponse.subscription_status}, Plan: ${userResponse.subscription_plan}`);

        res.json({
            success: true,
            message: 'Login successful',
            token: token,
            user: userResponse,
            user_type: userType,
            token_expires_in: '24 hours'
        });

    } catch (error) {
        debug.error('Login error:', error);
        res.status(500).json({ success: false, error: 'Login failed', details: error.message });
    }
});

router.post('/verify-token', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            res.json({ success: true, valid: true, decoded, message: 'Token is valid' });
        } catch (jwtError) {
            res.status(401).json({ success: false, valid: false, error: jwtError.message });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// Register Individual
router.post('/register', async (req, res) => {
    try {
        const { email, password, full_name, phone = '', country = 'Ethiopia', region = '', woreda = '', tin_number = '', license_number = '', role = 'pharmacist', account_type = 'individual' } = req.body;

        if (!email || !password || !full_name || !phone) return res.status(400).json({ success: false, error: 'Required fields missing' });
        const trimmedEmail = email.trim().toLowerCase();
        if (!isValidEmail(trimmedEmail)) return res.status(400).json({ success: false, error: 'Invalid email' });
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: existingUser } = await supabase.from('users').select('id').eq('email', trimmedEmail).maybeSingle();
        if (existingUser) return res.status(400).json({ success: false, error: 'Email already registered' });

        const hashedPassword = await bcrypt.hash(password.trim(), 10);
        const userData = {
            email: trimmedEmail,
            password_hash: hashedPassword,
            full_name: full_name.trim(),
            phone: phone.trim(),
            country: country.trim(),
            region: region.trim(),
            woreda: woreda.trim(),
            tin_number: tin_number.trim(),
            license_number: license_number?.trim() || '',
            approved: false,
            role: role || 'pharmacist',
            account_type: account_type || 'individual',
            subscription_status: 'inactive',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: user, error: insertError } = await supabase.from('users').insert([userData]).select().single();
        if (insertError) throw insertError;

        res.status(201).json({
            success: true,
            message: 'Registration successful! Please wait for admin approval.',
            user: { id: user.id, email: user.email }, // minimal response
            id: user.id,
            userId: user.id
        });
    } catch (error) {
        debug.error('Registration error:', error);
        res.status(500).json({ success: false, error: 'Registration failed', details: error.message });
    }
});

// Register Company
router.post('/register-company', async (req, res) => {
    try {
        const { company_name, company_email, company_address, company_size = '1-10', company_type = 'pharmacy', tin_number, country = 'Ethiopia', region, user_capacity = 5, admin_email, admin_password, admin_full_name, admin_phone, admin_license_number = '' } = req.body;

        if (!company_name || !company_email || !admin_email || !admin_password || !admin_full_name || !admin_phone) {
            return res.status(400).json({ success: false, error: 'Required fields missing' });
        }
        const trimmedAdminEmail = admin_email.trim().toLowerCase();
        if (!isValidEmail(trimmedAdminEmail)) return res.status(400).json({ error: 'Invalid admin email' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const searchFilter = `company_name.ilike.%${company_name.trim()}%`;

        // OLD: .maybeSingle() crashed on duplicates
        // NEW: .limit(1) and array length check
        const { data: existingCompanies, error: searchError } = await supabase
            .from('companies')
            .select('id')
            .or(searchFilter)
            .limit(1);

        if (searchError) {
            debug.error('Company search error:', searchError);
            return res.status(500).json({ success: false, error: 'Error checking existing companies: ' + searchError.message });
        }
        if (existingCompanies && existingCompanies.length > 0) {
            return res.status(400).json({ error: 'Company exists with this name' });
        }

        const { data: existingAdmins, error: adminSearchError } = await supabase
            .from('users')
            .select('id')
            .eq('email', trimmedAdminEmail)
            .limit(1);

        if (adminSearchError) {
            debug.error('Admin search error:', adminSearchError);
            return res.status(500).json({ success: false, error: 'Error checking existing users' });
        }
        if (existingAdmins && existingAdmins.length > 0) {
            return res.status(400).json({ error: 'Admin email taken' });
        }

        const hashedPassword = await bcrypt.hash(admin_password.trim(), 10);
        const companyData = {
            company_name: company_name.trim(),
            email: company_email.trim().toLowerCase(), // Company's general email
            admin_email: trimmedAdminEmail,            // Admin's specific email (stored for reference)
            company_address: company_address?.trim() || '',
            company_size,
            company_type,
            tin_number: tin_number?.trim() || '',
            country: country.trim(),
            region: region?.trim() || '',
            user_capacity: parseInt(user_capacity) || 5,
            subscription_status: 'inactive',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        const { data: companies, error: companyError } = await supabase.from('companies').insert([companyData]).select();
        const company = companies?.[0];

        if (companyError || !company) {
            debug.error('Company insert error:', companyError);
            // Check for duplicate errors
            if (companyError.message?.includes('company_name')) {
                return res.status(400).json({
                    success: false,
                    error: 'Company name already exists. Please use a different company name.'
                });
            }
            // Removed registration number check
            throw companyError;
        }

        const adminData = {
            email: trimmedAdminEmail, password_hash: hashedPassword,
            full_name: admin_full_name.trim(), phone: admin_phone.trim(),
            company_id: company.id, institution: company_name.trim(),
            country: company.country, region: company.region,
            license_number: admin_license_number?.trim() || '',
            tin_number: tin_number?.trim() || '',
            approved: false, role: 'company_admin', account_type: 'company',
            subscription_status: 'inactive',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };

        const { data: adminUsers, error: adminError } = await supabase.from('users').insert([adminData]).select();
        const adminUser = adminUsers?.[0];

        if (adminError || !adminUser) {
            debug.error('Compancy admin insert error:', adminError);
            await supabase.from('companies').delete().eq('id', company.id);
            throw adminError;
        }

        const { error: updateError } = await supabase.from('companies').update({ admin_id: adminUser.id }).eq('id', company.id);
        if (updateError) {
            debug.error('Company update admin_id error:', updateError);
            // Verify if this is fatal? Probably not, but worth logging.
        }

        res.status(201).json({ success: true, message: 'Company registration successful!', user: { id: adminUser.id } });
    } catch (error) {
        debug.error('Company registration error:', error);

        // Provide user-friendly error messages
        let errorMessage = 'Registration failed';
        if (error.message?.includes('duplicate key')) {
            errorMessage = 'A company with this information already exists. Please check your registration number and company name.';
        } else if (error.message) {
            errorMessage = error.message;
        }

        // Return 500 but with specific message so user knows what went wrong
        res.status(500).json({ success: false, error: errorMessage, details: error.details || error.hint });
    }
});

// Get Me
router.get('/me', authenticateToken, async (req, res) => {
    try {
        let user = null;
        const { userId, account_type } = req.user;

        if (account_type === 'company_user' || req.user.user_type === 'company_user') {
            const { data } = await supabase.from('company_users').select('*').eq('id', userId).maybeSingle();
            if (data) user = { ...data, user_type: 'company_user', account_type: 'company_user' };
        } else {
            const { data } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
            if (data) user = { ...data, user_type: 'regular_user' };
        }

        if (!user) { // Fallback
            const { data: u } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
            if (u) user = { ...u, user_type: 'regular_user' };
            else {
                const { data: cu } = await supabase.from('company_users').select('*').eq('id', userId).maybeSingle();
                if (cu) user = { ...cu, user_type: 'company_user', account_type: 'company_user' };
            }
        }

        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        // NEW: Robust company identification
        if (!user.company_id) {
            const { data: employeeRecord } = await supabase
                .from('company_users')
                .select('company_id')
                .ilike('email', user.email.trim().toLowerCase())
                .maybeSingle();

            if (employeeRecord && employeeRecord.company_id) {
                user.company_id = employeeRecord.company_id;
                user.is_shared_account = true; // Mark that we found a link
            }
        }

        let companyData = null;
        if (user.company_id) {
            const { data } = await supabase.from('companies').select('*').eq('id', user.company_id).maybeSingle();
            companyData = data;
        }

        // Check if we should inherit subscription status from company
        let hasCompanySubscription = companyData && companyData.subscription_status === 'active';

        // NEW: Backup check in subscriptions history if company record is out of sync
        if (user.company_id && !hasCompanySubscription) {
            const { data: activeSub } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('company_id', user.company_id)
                .eq('status', 'active')
                .gt('end_date', new Date().toISOString())
                .order('end_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (activeSub) {
                console.log(`[Auth] Recovered active subscription for company ${user.company_id} via subscriptions table`);
                hasCompanySubscription = true;
                // Update local companyData for the response
                companyData = companyData || { id: user.company_id };
                companyData.subscription_status = 'active';
                companyData.subscription_plan = activeSub.plan_id;
                companyData.subscription_end_date = activeSub.end_date;
            }
        }

        const isEffectivelyCompanyUser = user.user_type === 'company_user' || !!user.company_id;

        const userResponse = {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            account_type: isEffectivelyCompanyUser ? 'company_user' : (user.account_type || 'individual'),
            phone: user.phone,
            approved: user.approved,
            institution: user.institution || (companyData ? companyData.company_name : ''),
            country: user.country,
            region: user.region,
            company: companyData,
            company_id: user.company_id,
            // Inherit active status from company if available
            subscription_status: hasCompanySubscription ? 'active' : (user.subscription_status || 'inactive'),
            subscription_plan: hasCompanySubscription ? companyData.subscription_plan : (user.subscription_plan || null),
            subscription_end_date: hasCompanySubscription ? companyData.subscription_end_date : user.subscription_end_date,
            created_at: user.created_at
        };

        console.log(`[Auth] Profile for ${user.email}. EffectivelyCompany: ${isEffectivelyCompanyUser}, Sub: ${userResponse.subscription_status}`);

        res.json({ success: true, user: userResponse, user_type: user.user_type });
    } catch (e) {
        debug.error('Get profile error:', e);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

router.put('/update-profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const updates = { ...req.body };
        ['id', 'email', 'role', 'approved', 'account_type', 'created_at', 'password_hash', 'specialization'].forEach(k => delete updates[k]);
        updates.updated_at = new Date().toISOString();

        const { data: user, error } = await supabase.from('users').update(updates).eq('id', userId).select().single();
        if (error) throw error;

        res.json({ success: true, message: 'Profile updated', user });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Update failed' });
    }
});

router.post('/change-password', authenticateToken, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password || new_password.length < 6) return res.status(400).json({ error: 'Invalid input' });

        const { data: user } = await supabase.from('users').select('password_hash').eq('id', req.user.userId).single();
        if (!user) return res.status(404).json({ error: 'User not found' });

        const valid = await bcrypt.compare(current_password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Incorrect password' });

        const hash = await bcrypt.hash(new_password, 10);
        await supabase.from('users').update({ password_hash: hash, updated_at: new Date().toISOString() }).eq('id', req.user.userId);

        res.json({ success: true, message: 'Password changed' });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

export default router;
