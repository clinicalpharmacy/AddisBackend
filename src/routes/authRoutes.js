import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/env.js';
import { isValidEmail } from '../utils/helpers.js';
import { authenticateToken, getPatientLimit, getPatientLimitMessage, checkPatientLimit } from '../middleware/authMiddleware.js';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../utils/emailService.js';
import { EncryptionService } from '../utils/encryptionService.js';

const router = express.Router();
const JWT_SECRET = config.jwtSecret;

// 👤 Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const db = supabaseAdmin || supabase;

        // Check regular users
        let { data, error } = await db.from('users').select('*').eq('id', userId).maybeSingle();

        if (!data) {
            const { data: cData, error: cErr } = await db.from('company_users').select('*').eq('id', userId).maybeSingle();
            data = cData;
            error = cErr;
        }

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Profile not found' });

        // Remove sensitive fields
        delete data.password_hash;
        delete data.verification_token;

        res.json({ success: true, user: data });
    } catch (err) {
        console.error('❌ [Auth/Me] error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch profile' });
    }
});

// Helper to generate random token
const generateToken = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// User Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const db = supabaseAdmin || supabase;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }
        if (!db) return res.status(503).json({ success: false, error: 'Database not configured' });

        let cleanEmail = email.trim().toLowerCase();
        const cleanPassword = password.trim();

        // Support Healthcare Client ID login by appending domain if needed
        if (cleanEmail.startsWith('hcc-') && !cleanEmail.includes('@')) {
            cleanEmail = `${cleanEmail}@hcc.addis-med.com`;
        }
        let user = null;
        let userType = null;
        let fetchError = null;

        const { data: regularUser, error: regularError } = await db.from('users').select('*, encryption_salt').eq('email', cleanEmail).maybeSingle();


        if (regularUser) {
            user = regularUser;
            userType = 'regular_user';
        } else {
            const { data: companyUser, error: companyError } = await db.from('company_users').select('*, encryption_salt').eq('email', cleanEmail).maybeSingle();

            if (companyError) console.error('❌ AUTH DEBUG DB Error:', companyError);
            if (companyUser) {
                user = companyUser;
                userType = 'company_user';
            } else {
                fetchError = regularError; // Default error to regular
            }
        }

        if (fetchError) return res.status(500).json({ success: false, error: 'Database error' });

        if (!user) {
            // AUTH DEBUG: Check if user exists with any casing if not found
            const { data: anyCaseUser } = await db.from('users').select('id, email').ilike('email', cleanEmail).maybeSingle();

            let errorMsg = process.env.NODE_ENV === 'development'
                ? `Debug: User ${cleanEmail} not found. AdminClient: ${!!supabaseAdmin}`
                : 'Invalid email or password';

            if (anyCaseUser) {
                errorMsg += ` (Found similar email: ${anyCaseUser.email})`;
            }

            console.log(`❌ Auth Fail: ${cleanEmail} not found in DB.`);
            return res.status(401).json({ success: false, error: errorMsg });
        }

        let validPassword = false;
        if (user.password_hash) {
            validPassword = await bcrypt.compare(cleanPassword, user.password_hash);
        }


        if (!validPassword) {
            const errorMsg = process.env.NODE_ENV === 'development' ? 'Debug: Password mismatch' : 'Invalid email or password';
            return res.status(401).json({ success: false, error: errorMsg });
        }

        // Check verification and approval - Skip for admin, superadmin
        if (user.role !== 'admin' && user.role !== 'superadmin') {
            const isVerified = user.email_verified;
            const isApproved = user.approved;

            // 1. Company Admins: REQUIRE BOTH email verification and super-admin approval
            if (user.role === 'company_admin' || user.account_type === 'company') {
                if (!isVerified || !isApproved) {
                    return res.status(401).json({
                        success: false,
                        error: !isVerified ? 'Please verify your email address.' : 'Your account is pending administrator approval.',
                        email_verification_required: !isVerified,
                        approval_required: !isApproved
                    });
                }
            }

            // 2. Individuals/Company Staff: REQUIRE email verification 
            // (Approval is skipped because they are auto-approved as handled in signup/verification routes)
            if (!isVerified) {
                return res.status(401).json({
                    success: false,
                    error: 'Please verify your email address to log in.',
                    email_verification_required: true
                });
            }
        }

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: 'Your account has been blocked. Please contact your administrator.'
            });
        }

        let companyId = user.company_id;
        const db_search = db;

        if (!companyId) {
            const { data: employeeRecord } = await db_search
                .from('company_users')
                .select('company_id')
                .ilike('email', cleanEmail)
                .maybeSingle();

            if (employeeRecord && employeeRecord.company_id) {
                companyId = employeeRecord.company_id;
            }
        }

        const isEffectivelyCompanyUser = userType === 'company_user' || !!companyId;
        const account_type_to_use = isEffectivelyCompanyUser ? 'company_user' : (user.account_type || 'individual');

        const tokenPayload = {
            userId: user.id,
            email: user.email,
            name: user.full_name,
            role: user.role,
            approved: user.approved,
            account_type: account_type_to_use,
            user_type: userType,
            company_id: companyId
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        let companyData = null;
        if (companyId) {
            const { data } = await db.from('companies').select('*').eq('id', companyId).maybeSingle();
            companyData = data;
        }

        // --- CONSTRAINT FIX: Sync company user to regular 'users' table if missing ---
        if (userType === 'company_user' && user.id) {
            try {
                const { data: exists } = await db.from('users').select('id').eq('id', user.id).maybeSingle();
                if (!exists) {

                    await db.from('users').insert([{
                        id: user.id,
                        email: user.email,
                        full_name: user.full_name,
                        role: user.role,
                        company_id: companyId,
                        approved: true,
                        email_verified: user.email_verified,
                        password_hash: user.password_hash // Store hash for potential login fallback
                    }]);
                }
            } catch (syncError) {
                console.warn('⚠️ [FIX] User sync warning:', syncError.message);
            }
        }

        let hasCompanySubscription = companyData && companyData.subscription_status === 'active';

        // NEW: Backup check in subscriptions history if company record is out of sync
        if (companyId && !hasCompanySubscription) {
            const { data: activeSub } = await db
                .from('subscriptions')
                .select('*')
                .eq('company_id', companyId)
                .eq('status', 'active')
                .gt('end_date', new Date().toISOString())
                .order('end_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (activeSub) {

                hasCompanySubscription = true;
                companyData = companyData || { id: companyId };
                companyData.subscription_status = 'active';
                companyData.subscription_plan = activeSub.plan_id;
                companyData.subscription_end_date = activeSub.end_date;
            }
        }

        // Get patient limit info for the user
        const patientLimit = getPatientLimit(tokenPayload);
        const patientLimitMessage = getPatientLimitMessage(tokenPayload);
        
        // Optionally check current patient count (can be done on frontend via /patients/count endpoint)
        let patientLimitCheck = null;
        try {
            patientLimitCheck = await checkPatientLimit(tokenPayload, db);
        } catch (limitError) {
            console.warn('Could not check patient limit during login:', limitError.message);
        }

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
            license_number: user.license_number || '',
            email_verified: user.email_verified,
            // Patient limit info
            patient_limit: patientLimit === Infinity ? 'unlimited' : patientLimit,
            patient_limit_message: patientLimitMessage,
            patient_limit_info: patientLimitCheck ? {
                canAdd: patientLimitCheck.canAdd,
                current: patientLimitCheck.current,
                remaining: patientLimitCheck.remaining,
                limit: patientLimitCheck.limit
            } : null,
            // 🛡️ PKI: Security Keys for Zero-Knowledge Restoration
            public_key: user.public_key,
            private_key_encrypted: user.private_key_encrypted
        };

        // 🔐 ZERO-KNOWLEDGE: Return the user's encryption salt
        let encryptionSalt = user.encryption_salt;
        
        console.log(`🔍 [Auth] Login attempt for: ${user.email}. Existing salt: ${!!encryptionSalt}`);

        if (!encryptionSalt) {
            encryptionSalt = EncryptionService.generateSalt();
            const table = userType === 'company_user' ? 'company_users' : 'users';
            
            try {
                const { error: updateErr } = await db.from(table).update({ encryption_salt: encryptionSalt }).eq('id', user.id);
                if (updateErr) throw updateErr;
                console.log(`✅ [Encryption] Generated and SAVED salt for: ${user.email}`);
            } catch (err) {
                console.error(`❌ [Encryption] Could not save salt to DB, using memory-only for this session:`, err);
            }
        }

        res.json({
            success: true,
            message: 'Login successful',
            token: token,
            user: userResponse,
            user_type: userType,
            token_expires_in: '24 hours',
            encryption_salt: encryptionSalt
        });

    } catch (error) {
        console.error('Login error:', error);
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
            
            // Add patient limit info to the response
            const patientLimit = getPatientLimit(decoded);
            const patientLimitMessage = getPatientLimitMessage(decoded);
            
            res.json({ 
                success: true, 
                valid: true, 
                decoded, 
                message: 'Token is valid',
                patient_limit: patientLimit === Infinity ? 'unlimited' : patientLimit,
                patient_limit_message: patientLimitMessage
            });
        } catch (jwtError) {
            res.status(401).json({ success: false, valid: false, error: jwtError.message });
        }
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// Register Individual
router.post('/register', async (req, res) => {
    try {
        const { email, password, full_name, phone = '', country = 'Ethiopia', region = '', woreda = '', tin_number = '', license_number = '', role = 'pharmacist', account_type = 'individual', skip_verification_email = false } = req.body;

        if (!email || !password || !full_name || !phone) return res.status(400).json({ success: false, error: 'Required fields missing' });
        const trimmedEmail = email.trim().toLowerCase();
        if (!isValidEmail(trimmedEmail)) return res.status(400).json({ success: false, error: 'Invalid email' });
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: existingUser } = await supabase.from('users').select('id').eq('email', trimmedEmail).maybeSingle();
        if (existingUser) return res.status(400).json({ success: false, error: 'Email already registered' });

        const hashedPassword = await bcrypt.hash(password.trim(), 10);

        // Generate encryption salt for zero-knowledge patient data protection
        const encryptionSalt = EncryptionService.generateSalt();

        // Generate email verification token
        const verificationToken = generateToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

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
            approved: true, // Auto-approve individuals
            role: role || 'pharmacist',
            account_type: account_type || 'individual',
            subscription_status: 'inactive',
            email_verified: false,
            email_verification_token: verificationToken,
            email_verification_expires: verificationExpires,
            encryption_salt: encryptionSalt,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: user, error: insertError } = await supabase.from('users').insert([userData]).select().single();
        if (insertError) throw insertError;

        // Get patient limit info for the new user
        const mockUser = { role, account_type, userId: user.id };
        const patientLimit = getPatientLimit(mockUser);
        const patientLimitMessage = getPatientLimitMessage(mockUser);

        if (!skip_verification_email) {
            // Send verification email (don't wait for it to complete)
            sendVerificationEmail(trimmedEmail, full_name.trim(), verificationToken).catch(err => {
                console.error('Failed to send verification email:', err);
            });
        }

        res.status(201).json({
            success: true,
            message: skip_verification_email
                ? 'Registration successful! Please complete your payment to verify your account.'
                : 'Registration successful! Please check your email to verify your account.',
            user: { id: user.id, email: user.email },
            id: user.id,
            userId: user.id,
            email_verification_required: !skip_verification_email,
            email_verification_skipped: !!skip_verification_email,
            patient_limit: patientLimit === Infinity ? 'unlimited' : patientLimit,
            patient_limit_message: patientLimitMessage,
            encryption_salt: encryptionSalt
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, error: 'Registration failed', details: error.message });
    }
});

// Register Company
router.post('/register-company', async (req, res) => {
    try {
        const { company_name, company_email, company_address, company_size = '1-10', company_type = 'pharmacy', tin_number, country = 'Ethiopia', region, user_capacity = 5, admin_email, admin_password, admin_full_name, admin_phone, admin_license_number = '', skip_verification_email = false } = req.body;

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
            return res.status(500).json({ success: false, error: 'Error checking existing users' });
        }
        if (existingAdmins && existingAdmins.length > 0) {
            return res.status(400).json({ error: 'Admin email taken' });
        }

        const hashedPassword = await bcrypt.hash(admin_password.trim(), 10);

        // Generate encryption salt for the company admin
        const encryptionSalt = EncryptionService.generateSalt();

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

        // Generate email verification token for admin
        const verificationToken = generateToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

        const adminData = {
            email: trimmedAdminEmail, password_hash: hashedPassword,
            full_name: admin_full_name.trim(), phone: admin_phone.trim(),
            company_id: company.id, institution: company_name.trim(),
            country: company.country, region: company.region,
            license_number: admin_license_number?.trim() || '',
            tin_number: tin_number?.trim() || '',
            approved: false, role: 'company_admin', account_type: 'company',
            subscription_status: 'inactive',
            email_verified: false,
            email_verification_token: verificationToken,
            email_verification_expires: verificationExpires,
            encryption_salt: encryptionSalt,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };

        const { data: adminUsers, error: adminError } = await supabase.from('users').insert([adminData]).select();
        const adminUser = adminUsers?.[0];

        if (adminError || !adminUser) {
            await supabase.from('companies').delete().eq('id', company.id);
            throw adminError;
        }

        const { error: updateError } = await supabase.from('companies').update({ admin_id: adminUser.id }).eq('id', company.id);
        if (updateError) {
            // console.error('Company update admin_id error:', updateError);
        }

        if (!skip_verification_email) {
            // Send verification email to admin (don't wait for it to complete)
            sendVerificationEmail(trimmedAdminEmail, admin_full_name.trim(), verificationToken).catch(err => {
                console.error('Failed to send verification email:', err);
            });
        }

        res.status(201).json({
            success: true,
            message: skip_verification_email
                ? 'Company registration successful! Please complete payment to verify your account.'
                : 'Company registration successful! Please check your email to verify your account.',
            user: { id: adminUser.id },
            email_verification_required: !skip_verification_email,
            email_verification_skipped: !!skip_verification_email,
            encryption_salt: encryptionSalt
        });
    } catch (error) {
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
            const { data: activeSub = null } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('company_id', user.company_id)
                .eq('status', 'active')
                .gt('end_date', new Date().toISOString())
                .order('end_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (activeSub) {
                hasCompanySubscription = true;
                // Update local companyData for the response
                companyData = companyData || { id: user.company_id };
                companyData.subscription_status = 'active';
                companyData.subscription_plan = activeSub.plan_id;
                companyData.subscription_end_date = activeSub.end_date;
            }
        }

        const isEffectivelyCompanyUser = user.user_type === 'company_user' || !!user.company_id;

        // Get patient limit info for the user
        const mockUser = {
            role: user.role,
            account_type: user.account_type || (isEffectivelyCompanyUser ? 'company_user' : 'individual'),
            company_id: user.company_id,
            userId: user.id
        };
        const patientLimit = getPatientLimit(mockUser);
        const patientLimitMessage = getPatientLimitMessage(mockUser);
        
        // Optionally check current patient count
        let patientLimitCheck = null;
        try {
            patientLimitCheck = await checkPatientLimit(mockUser, supabase);
        } catch (limitError) {
            console.warn('Could not check patient limit in /me:', limitError.message);
        }

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
            created_at: user.created_at,
            // Patient limit info
            patient_limit: patientLimit === Infinity ? 'unlimited' : patientLimit,
            patient_limit_message: patientLimitMessage,
            patient_limit_info: patientLimitCheck ? {
                canAdd: patientLimitCheck.canAdd,
                current: patientLimitCheck.current,
                remaining: patientLimitCheck.remaining,
                limit: patientLimitCheck.limit === Infinity ? 'unlimited' : patientLimitCheck.limit
            } : null
        };

        res.json({ success: true, user: userResponse, user_type: user.user_type });
    } catch (e) {
        console.error('/me error:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch user data' });
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
        console.error('Profile update error:', e);
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
        console.error('Password change error:', e);
        res.status(500).json({ success: false, error: 'Failed to change password' });
    }
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const db = supabaseAdmin || supabase;
        const cleanEmail = email.trim().toLowerCase();

        // Check both tables
        let user = null;
        let table = 'users';

        const { data: regularUser } = await db.from('users').select('id, email').eq('email', cleanEmail).maybeSingle();
        if (regularUser) {
            user = regularUser;
        } else {
            const { data: companyUser } = await db.from('company_users').select('id, email').eq('email', cleanEmail).maybeSingle();
            if (companyUser) {
                user = companyUser;
                table = 'company_users';
            }
        }

        if (!user) {
            // For security, don't reveal if user exists. But for this app's context, we'll be helpful.
            return res.status(404).json({ error: 'User not found' });
        }

        const token = generateToken();
        const expires = new Date(Date.now() + 3600000).toISOString(); // 1 hour

        await db.from(table).update({
            reset_password_token: token,
            reset_password_expires: expires
        }).eq('id', user.id);

        // In a real app, send email here.
        // console.log(`Reset token for ${email}: ${token}`);

        res.json({
            success: true,
            message: 'Reset token generated.',
            reset_token: token
        });
    } catch (e) {
        console.error('Forgot password error:', e);
        res.status(500).json({ success: false, error: 'Failed to process request' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { token, new_password } = req.body;
        if (!token || !new_password || new_password.length < 6) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        const db = supabaseAdmin || supabase;
        const now = new Date().toISOString();

        // Search in both tables for the token
        let user = null;
        let table = 'users';

        const { data: regularUser } = await db.from('users')
            .select('id')
            .eq('reset_password_token', token)
            .gt('reset_password_expires', now)
            .maybeSingle();

        if (regularUser) {
            user = regularUser;
        } else {
            const { data: companyUser } = await db.from('company_users')
                .select('id')
                .eq('reset_password_token', token)
                .gt('reset_password_expires', now)
                .maybeSingle();

            if (companyUser) {
                user = companyUser;
                table = 'company_users';
            }
        }

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const hash = await bcrypt.hash(new_password, 10);
        await db.from(table).update({
            password_hash: hash,
            reset_password_token: null,
            reset_password_expires: null,
            updated_at: new Date().toISOString()
        }).eq('id', user.id);

        res.json({ success: true, message: 'Password has been reset successfully' });
    } catch (e) {
        console.error('Reset password error:', e);
        res.status(500).json({ success: false, error: 'Reset failed' });
    }
});

// Verify Email
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ success: false, error: 'Verification token is required' });
        }

        const db = supabaseAdmin || supabase;
        const now = new Date().toISOString();

        // Search in both tables for the token
        let user = null;
        let table = 'users';

        const { data: regularUser } = await db.from('users')
            .select('*')
            .eq('email_verification_token', token)
            .gt('email_verification_expires', now)
            .maybeSingle();

        if (regularUser) {
            user = regularUser;
        } else {
            const { data: companyUser } = await db.from('company_users')
                .select('*')
                .eq('email_verification_token', token)
                .gt('email_verification_expires', now)
                .maybeSingle();

            if (companyUser) {
                user = companyUser;
                table = 'company_users';
            }
        }

        if (!user) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired verification token. Please request a new verification email.'
            });
        }

        // Check if already verified
        if (user.email_verified) {
            return res.json({
                success: true,
                message: 'Email already verified. You can now log in.',
                already_verified: true
            });
        }

        // Update user to mark email as verified
        // AUTO-APPROVE: If individual/regular user (not company admin), automatically approve on verification
        // Company Admins (role='company_admin') must be manually approved by Super Admin.
        // AUTO-APPROVE: 
        // 1. Individual users (pharmacists) are auto-approved on verification.
        // 2. Company employees (company_users table) are auto-approved.
        // 3. ONLY Company Admins (role='company_admin') require manual super-admin approval.
        let autoApprove = true;

        if (table === 'users') {
            if (user.role === 'company_admin' || user.account_type === 'company') {
                autoApprove = false;
            }
        }

        const updates = {
            email_verified: true,
            email_verification_token: null,
            email_verification_expires: null,
            updated_at: new Date().toISOString()
        };

        if (autoApprove) {
            updates.approved = true;
        }

        await db.from(table).update(updates).eq('id', user.id);

        // Send welcome email (don't wait for it to complete)
        sendWelcomeEmail(user.email, user.full_name).catch(err => {
            console.error('Failed to send welcome email:', err);
        });

        res.json({
            success: true,
            message: autoApprove
                ? 'Email verified successfully! You can now log in.'
                : 'Email verified successfully! Your company account is pending admin approval.',
            email_verified: true,
            auto_approved: autoApprove
        });
    } catch (e) {
        console.error('Email verification error:', e);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// Resend Verification Email
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const db = supabaseAdmin || supabase;
        const cleanEmail = email.trim().toLowerCase();

        // Check both tables
        let user = null;
        let table = 'users';

        const { data: regularUser } = await db.from('users')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (regularUser) {
            user = regularUser;
        } else {
            const { data: companyUser } = await db.from('company_users')
                .select('*')
                .eq('email', cleanEmail)
                .maybeSingle();

            if (companyUser) {
                user = companyUser;
                table = 'company_users';
            }
        }

        if (!user) {
            // For security, don't reveal if user exists
            return res.json({
                success: true,
                message: 'If an account exists with this email, a verification link has been sent.'
            });
        }

        // ENFORCE: Verification only after payment
        let hasPaid = user.subscription_status === 'active';

        // If it's a company user, they don't pay individually, but their company must have a subscription
        if (!hasPaid && table === 'company_users' && user.company_id) {
            const { data: comp } = await db.from('companies').select('subscription_status').eq('id', user.company_id).maybeSingle();
            if (comp?.subscription_status === 'active') {
                hasPaid = true;
            }
        }

        if (!hasPaid) {
            return res.status(403).json({
                success: false,
                error: 'Verification email can only be sent after a successful subscription payment. Please complete your payment first.'
            });
        }

        // Check if already verified
        if (user.email_verified) {
            return res.json({
                success: true,
                message: 'Email already verified. You can log in now.',
                already_verified: true
            });
        }

        // Generate new verification token
        const verificationToken = generateToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

        // Update user with new token
        await db.from(table).update({
            email_verification_token: verificationToken,
            email_verification_expires: verificationExpires,
            updated_at: new Date().toISOString()
        }).eq('id', user.id);

        // Send verification email
        const emailSent = await sendVerificationEmail(cleanEmail, user.full_name, verificationToken);

        if (!emailSent) {
            return res.status(500).json({
                success: false,
                error: 'Failed to send verification email. Please try again later.'
            });
        }

        res.json({
            success: true,
            message: 'Verification email sent! Please check your inbox.'
        });
    } catch (e) {
        console.error('Resend verification error:', e);
        res.status(500).json({ success: false, error: 'Failed to resend verification email' });
    }
});

/**
 * 🔍 SEARCH SPECIALIST BY EMAIL
 * Allows owners to manually link a troubleshoot specialist by email.
 */
router.get('/search', authenticateToken, async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const { data: user, error } = await supabase
            .from('users')
            .select('id, full_name, role, public_key')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({ success: true, user });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ success: false, error: 'Internal search error' });
    }
});

/**
 * 🔐 UPDATE ENCRYPTION KEYS (Zero-Knowledge PKI)
 * Saves the user's Public Key and Wrapped Private Key.
 */
router.post('/update-encryption-keys', authenticateToken, async (req, res) => {
    try {
        const { public_key, private_key_encrypted } = req.body;
        // Use userId from the token payload (req.user.userId)
        const userId = req.user && (req.user.userId || req.user.id);
        const db = supabaseAdmin || supabase;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'User identity missing from token' });
        }

        if (!public_key || !private_key_encrypted) {
            return res.status(400).json({ success: false, error: 'Both keys are required' });
        }

        console.log(`🔐 [Encryption] Syncing keys for user: ${userId}`);

        let updateSuccess = false;
        let updateError = null;

        // 1. Try updating in 'users' table
        const { data: userData, error: userErr } = await db.from('users')
            .update({ public_key, private_key_encrypted, updated_at: new Date().toISOString() })
            .eq('id', userId)
            .select();

        if (userData && userData.length > 0 && !userErr) {
            updateSuccess = true;
        } else if (userErr) {
            updateError = userErr;
        }

        // 2. If not found in 'users', try 'company_users' table
        if (!updateSuccess) {
            const { data: compData, error: compErr } = await db.from('company_users')
                .update({ public_key, private_key_encrypted, updated_at: new Date().toISOString() })
                .eq('id', userId)
                .select();

            if (compData && compData.length > 0 && !compErr) {
                updateSuccess = true;
            } else if (compErr) {
                updateError = compErr;
            }
        }

        if (!updateSuccess) {
            console.error(`❌ [Auth] Update failed for keys. User: ${userId}. Error:`, updateError?.message || 'User not found');
            return res.status(404).json({ 
                success: false, 
                error: updateError ? `Database error: ${updateError.message}` : 'User record not found in verified tables' 
            });
        }

        res.json({ success: true, message: 'Security keys synchronized successfully' });
    } catch (err) {
        console.error('❌ [Auth] Unexpected error updating encryption keys:', err.message);
        res.status(500).json({ success: false, error: `Failed to update security keys: ${err.message}` });
    }
});

/**
 * 🔍 SEARCH USER BY EMAIL
 * Finds a user's public info (including public key) for data sharing.
 */
router.get('/search', authenticateToken, async (req, res) => {
    try {
        const { email } = req.query;
        const db = supabaseAdmin || supabase;
        
        if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

        const cleanEmail = email.trim().toLowerCase();

        // Check regular users
        let { data, error } = await db.from('users')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle();

        // Check company users if not found
        if (!data) {
            const { data: cData, error: cErr } = await db.from('company_users')
                .select('*')
                .eq('email', cleanEmail)
                .maybeSingle();
            data = cData;
            error = cErr;
        }

        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'User not found in verified registry' });

        // Enforce admin-only sharing for Support feature
        if (data.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Authorization restricted to Verified Administrators only' });
        }

        res.json({ success: true, user: data });
    } catch (err) {
        console.error('❌ [Auth] Search error:', err.message);
        res.status(500).json({ success: false, error: `Search encountered an error: ${err.message}` });
    }
});


export default router;
