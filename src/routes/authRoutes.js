import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
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

        // Check company subscription if user has company_id
        // BUT respect individual account_type — don't re-attach detached users
        const dbAccountType = data.account_type || 'individual';
        const isPlanIndividual = data.subscription_plan && data.subscription_plan.startsWith('individual');
        const isIndividual = dbAccountType === 'individual' || isPlanIndividual;

        let companyId = isIndividual ? null : data.company_id;

        // Only look up company_users if the DB record suggests a company association
        if (!companyId && !isIndividual) {
            companyId = req.user.company_id || null;
            if (!companyId) {
                const { data: compUser } = await db.from('company_users').select('company_id').eq('id', userId).maybeSingle();
                if (compUser && compUser.company_id) companyId = compUser.company_id;
            }
        }

        if (companyId && !isIndividual) {
            data.company_id = companyId;
            let { data: company } = await db.from('companies').select('*').eq('id', companyId).maybeSingle();
            let hasCompanySubscription = company && company.subscription_status === 'active';

            if (!hasCompanySubscription) {
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
                    company = company || { id: companyId };
                    company.subscription_status = 'active';
                    company.subscription_plan = activeSub.plan_id;
                    company.subscription_end_date = activeSub.end_date;
                }
            }

            if (hasCompanySubscription) {
                data.subscription_status = 'active';
                data.subscription_plan = company.subscription_plan;
                data.subscription_end_date = company.subscription_end_date;
                data.has_subscription = true;
            }
            data.company = company;
            if (data.role !== 'company_admin' && data.role !== 'admin' && data.role !== 'superadmin') {
                data.account_type = 'company_user';
            }
        } else {
            // Ensure individual or detached users don't get company data attached
            data.company_id = null;
            data.company = null;
            data.account_type = 'individual';
            if (data.role === 'company_admin') {
                data.role = 'user';
            }
        }

        // Remove sensitive fields
        delete data.password_hash;
        delete data.verification_token;

        res.json({ success: true, user: data });
    } catch (err) {
        console.error('❌ [Auth/Me] error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch profile' });
    }
});

// 💰 Get user commission stats
router.get('/commissions', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const db = supabaseAdmin || supabase;

        // Get total commission
        const { data: commissions, error: commError } = await db.from('commissions')
            .select('amount')
            .eq('user_id', userId);

        if (commError) throw commError;

        const totalEarned = commissions ? commissions.reduce((sum, c) => sum + Number(c.amount), 0) : 0;
        const referralCount = commissions ? commissions.length : 0;

        // Get user's promotion code
        const { data: user, error: userError } = await db.from('users').select('promotion_code').eq('id', userId).maybeSingle();
        
        let promoCode = user?.promotion_code;
        if (!promoCode) {
            // Automatically generate one if it's missing (e.g. for accounts created before the feature)
            promoCode = `REF${Math.random().toString(36).substring(2, 8)}`.toUpperCase();
            await db.from('users').update({ promotion_code: promoCode }).eq('id', userId);
        }

        res.json({
            success: true,
            total_earned: totalEarned,
            referrals_count: referralCount,
            promotion_code: promoCode
        });
    } catch (err) {
        console.error('❌ [Auth/Commissions] error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch commissions' });
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

        // If regularUser password check failed, check if user exists in company_users with valid password
        if (!validPassword && userType === 'regular_user') {
            const { data: compUser } = await db.from('company_users').select('*, encryption_salt').eq('email', cleanEmail).maybeSingle();
            if (compUser && compUser.password_hash) {
                const compValid = await bcrypt.compare(cleanPassword, compUser.password_hash);
                if (compValid) {
                    validPassword = true;
                    user = compUser;
                    userType = 'company_user';
                    // Sync password and company affiliation to users table
                    await db.from('users').update({
                        password_hash: compUser.password_hash,
                        company_id: compUser.company_id,
                        account_type: 'company_user',
                        role: compUser.role || 'company_user',
                        email_verified: true,
                        approved: true,
                        subscription_status: compUser.subscription_status || 'active',
                        subscription_plan: compUser.subscription_plan,
                        subscription_end_date: compUser.subscription_end_date
                    }).eq('id', compUser.id);
                }
            }
        }

        if (!validPassword) {
            const errorMsg = process.env.NODE_ENV === 'development' ? 'Debug: Password mismatch' : 'Invalid email or password';
            return res.status(401).json({ success: false, error: errorMsg });
        }

        // Check if user is individual account or has individual plan
        const isPlanIndividual = user.subscription_plan && user.subscription_plan.startsWith('individual');
        const isExplicitlyIndividual = user.account_type === 'individual' || isPlanIndividual;

        let companyId = isExplicitlyIndividual ? null : user.company_id;
        if (!companyId && !isExplicitlyIndividual) {
            // Check company_users table
            const { data: employeeRecord } = await db
                .from('company_users')
                .select('company_id')
                .ilike('email', cleanEmail)
                .maybeSingle();

            if (employeeRecord && employeeRecord.company_id) {
                companyId = employeeRecord.company_id;
            } else if (user.role === 'company_admin' || user.account_type === 'company') {
                // Check if user is admin of any company by email or admin_id
                const { data: compByEmail } = await db
                    .from('companies')
                    .select('id')
                    .or(`admin_email.ilike.${cleanEmail},admin_id.eq.${user.id}`)
                    .maybeSingle();
                if (compByEmail && compByEmail.id) {
                    companyId = compByEmail.id;
                }
            }
        }

        // If explicitly individual, ensure DB has clean company_id and role
        if (isExplicitlyIndividual) {
            companyId = null;
            if (user.role === 'company_admin') {
                user.role = 'user';
                db.from('users').update({ company_id: null, role: 'user', account_type: 'individual' }).eq('id', user.id).then(() => {});
            }
        } else if (!companyId && user.role === 'company_admin') {
            // If they are marked company_admin but have NO company anywhere in DB,
            // prevent "No company associated with this account" crash by treating as individual
            console.warn(`⚠️ [Login] User ${user.email} is company_admin with no company. Falling back to individual.`);
            if (user.role !== 'admin' && user.role !== 'superadmin') {
                user.role = 'user';
            }
            user.account_type = 'individual';
            db.from('users').update({ company_id: null, role: user.role, account_type: 'individual' }).eq('id', user.id).then(() => {});
        }

        const isCompanyStaff = !isExplicitlyIndividual && (userType === 'company_user' || user.account_type === 'company_user' || (!!companyId && user.role !== 'company_admin'));
        const isCompanyAdmin = !isExplicitlyIndividual && !!companyId && (user.role === 'company_admin' || user.account_type === 'company');

        // Check verification and approval - Skip for admin, superadmin
        if (user.role !== 'admin' && user.role !== 'superadmin') {
            // 1. Company Admins: REQUIRE BOTH email verification and super-admin approval
            if (isCompanyAdmin) {
                const isVerified = user.email_verified;
                const isApproved = user.approved;
                if (!isVerified || !isApproved) {
                    return res.status(401).json({
                        success: false,
                        error: !isVerified ? 'Please verify your email address.' : 'Your account is pending administrator approval.',
                        email_verification_required: !isVerified,
                        approval_required: !isApproved
                    });
                }
            } else if (isCompanyStaff) {
                // 2. Company Staff: Created and provisioned by their Company Admin.
                // Auto-heal verified and approved status if needed.
                if (!user.email_verified || !user.approved) {
                    try {
                        const targetTbl = userType === 'company_user' ? 'company_users' : 'users';
                        await db.from(targetTbl).update({ email_verified: true, approved: true }).eq('id', user.id);
                        user.email_verified = true;
                        user.approved = true;
                    } catch (e) {
                        console.warn('Could not auto-heal company staff verification:', e.message);
                    }
                }
            } else {
                // 3. Regular Individual Users: REQUIRE email verification
                if (!user.email_verified) {
                    return res.status(401).json({
                        success: false,
                        error: 'Please verify your email address to log in.',
                        email_verification_required: true
                    });
                }
            }
        }

        if (user.is_blocked) {
            return res.status(403).json({
                success: false,
                error: 'Your account has been blocked. Please contact your administrator.'
            });
        }

        const account_type_to_use = isCompanyAdmin ? 'company' : (isCompanyStaff ? 'company_user' : 'individual');

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
                        account_type: 'company_user',
                        approved: true,
                        email_verified: true,
                        subscription_status: companyData?.subscription_status || user.subscription_status || 'inactive',
                        subscription_plan: companyData?.subscription_plan || user.subscription_plan || null,
                        subscription_end_date: companyData?.subscription_end_date || user.subscription_end_date || null,
                        password_hash: user.password_hash
                    }]);
                } else {
                    await db.from('users').update({
                        company_id: companyId,
                        account_type: 'company_user',
                        approved: true,
                        email_verified: true,
                        subscription_status: companyData?.subscription_status || user.subscription_status || 'inactive',
                        subscription_plan: companyData?.subscription_plan || user.subscription_plan || null,
                        subscription_end_date: companyData?.subscription_end_date || user.subscription_end_date || null,
                        updated_at: new Date().toISOString()
                    }).eq('id', user.id);
                }
            } catch (syncError) {
                console.warn('⚠️ [FIX] User sync warning:', syncError.message);
            }
        }

        // 🛡️ ONE ACTIVE SESSION PER USER ACCOUNT
        // Placed after the user sync to ensure foreign key constraint passes for company users
        const sessionId = uuidv4();
        
        try {
            // First, delete any existing sessions for this user
            const { error: deleteErr } = await db.from('active_sessions')
                .delete()
                .eq('user_id', user.id);
            if (deleteErr) console.error('Failed to delete old session:', deleteErr.message);

            // Then insert the new session
            const { error: insertErr } = await db.from('active_sessions').insert({
                user_id: user.id,
                session_id: sessionId,
                last_seen_at: new Date().toISOString()
            });
            if (insertErr) {
                console.error('Failed to insert active session:', insertErr.message);
            } else {
                console.log(`✅ Active session created for user ${user.id} (session: ${sessionId.substring(0, 8)}...)`);
            }
        } catch (err) {
            console.error('Active session error:', err);
        }

        const effectiveRole = (!companyId && user.role === 'company_admin') ? 'user' : (user.role || 'user');

        const tokenPayload = {
            userId: user.id,
            email: user.email,
            name: user.full_name,
            role: effectiveRole,
            approved: user.approved,
            account_type: account_type_to_use,
            user_type: userType,
            company_id: companyId,
            session_id: sessionId
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

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
            role: effectiveRole,
            approved: user.approved,
            account_type: account_type_to_use,
            institution: user.institution || (companyData ? companyData.company_name : ''),
            company_id: companyId,
            company: companyData,
            subscription_status: hasCompanySubscription ? 'active' : (user.subscription_status || 'inactive'),
            subscription_plan: hasCompanySubscription ? companyData.subscription_plan : (user.subscription_plan || null),
            subscription_end_date: hasCompanySubscription ? companyData.subscription_end_date : user.subscription_end_date,
            has_subscription: hasCompanySubscription || user.subscription_status === 'active',
            created_at: user.created_at,
            phone: user.phone,
            country: user.country,
            region: user.region,
            tin_number: user.tin_number || '',
            license_number: user.license_number || '',
            email_verified: isCompanyStaff ? true : user.email_verified,
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
// Validate Individual Registration (before payment)
router.post('/validate-registration', async (req, res) => {
    try {
        const { email, password, full_name, phone } = req.body;
        if (!email || !password || !full_name || !phone) return res.status(400).json({ success: false, error: 'Required fields missing' });
        
        const trimmedEmail = email.trim().toLowerCase();
        if (!isValidEmail(trimmedEmail)) return res.status(400).json({ success: false, error: 'Invalid email' });
        if (!supabase) return res.status(503).json({ success: false, error: 'Database not configured' });

        const { data: existingUser } = await supabase.from('users').select('id').eq('email', trimmedEmail).maybeSingle();
        if (existingUser) return res.status(400).json({ success: false, error: 'Email already registered' });

        res.status(200).json({ success: true, message: 'Validation successful' });
    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({ success: false, error: 'Validation failed', details: error.message });
    }
});

// Validate Company Registration (before payment)
router.post('/validate-company-registration', async (req, res) => {
    try {
        const { company_name, company_email, admin_email, admin_password, admin_full_name, admin_phone } = req.body;

        if (!company_name || !company_email || !admin_email || !admin_password || !admin_full_name || !admin_phone) {
            return res.status(400).json({ success: false, error: 'Required fields missing' });
        }
        
        const trimmedAdminEmail = admin_email.trim().toLowerCase();
        if (!isValidEmail(trimmedAdminEmail)) return res.status(400).json({ error: 'Invalid admin email' });
        if (!supabase) return res.status(503).json({ error: 'Database not configured' });

        const searchFilter = `company_name.ilike.%${company_name.trim()}%`;
        const { data: existingCompanies, error: searchError } = await supabase
            .from('companies')
            .select('id')
            .or(searchFilter)
            .limit(1);

        if (searchError) return res.status(500).json({ success: false, error: 'Error checking existing companies: ' + searchError.message });
        if (existingCompanies && existingCompanies.length > 0) return res.status(400).json({ error: 'Company exists with this name' });

        const { data: existingAdmins, error: adminSearchError } = await supabase
            .from('users')
            .select('id')
            .eq('email', trimmedAdminEmail)
            .limit(1);

        if (adminSearchError) return res.status(500).json({ success: false, error: 'Error checking existing users' });
        if (existingAdmins && existingAdmins.length > 0) return res.status(400).json({ error: 'Admin email taken' });

        res.status(200).json({ success: true, message: 'Validation successful' });
    } catch (error) {
        console.error('Company Validation error:', error);
        res.status(500).json({ success: false, error: 'Validation failed', details: error.message });
    }
});

// Register Individual
router.post('/register', async (req, res) => {
    try {
        const { email, password, full_name, phone = '', country = 'Ethiopia', region = '', woreda = '', tin_number = '', license_number = '', role = 'pharmacist', account_type = 'individual', skip_verification_email = false, referral_code } = req.body;

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

        // Handle referral code
        let referredById = null;
        if (referral_code) {
            const { data: referrer } = await supabase.from('users').select('id').eq('promotion_code', referral_code.trim().toUpperCase()).maybeSingle();
            if (referrer) {
                referredById = referrer.id;
            }
        }

        // Generate promotion code
        const nameBase = full_name ? full_name.replace(/[^a-zA-Z]/g, '').substring(0, 3).toUpperCase() : 'USR';
        const baseStr = nameBase.length > 0 ? nameBase : 'USR';
        const promotionCode = baseStr + Math.floor(Math.random() * 9000 + 1000) + Math.random().toString(36).substring(2, 5).toUpperCase();

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
            email_verified: account_type === 'company_user',
            email_verification_token: account_type === 'company_user' ? null : verificationToken,
            email_verification_expires: account_type === 'company_user' ? null : verificationExpires,
            encryption_salt: encryptionSalt,
            promotion_code: promotionCode,
            referred_by_id: referredById,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const { data: user, error: insertError } = await supabase.from('users').insert([userData]).select().single();
        if (insertError) throw insertError;

        // Get patient limit info for the new user
        const mockUser = { role, account_type, userId: user.id };
        const patientLimit = getPatientLimit(mockUser);
        const patientLimitMessage = getPatientLimitMessage(mockUser);

        const isCompanyUser = account_type === 'company_user';
        if (!skip_verification_email && !isCompanyUser) {
            // Send verification email (don't wait for it to complete)
            sendVerificationEmail(trimmedEmail, full_name.trim(), verificationToken)
                .then(sent => {
                    if (sent) console.log(`✅ [Registration] Verification email successfully sent to ${trimmedEmail}`);
                    else console.error(`❌ [Registration] Failed to send verification email to ${trimmedEmail}`);
                })
                .catch(err => {
                    console.error('❌ [Registration] Error sending verification email:', err);
                });
        }

        res.status(201).json({
            success: true,
            message: isCompanyUser
                ? 'Registration successful! You can log in directly.'
                : (skip_verification_email
                    ? 'Registration successful! Please complete your payment to verify your account.'
                    : 'Registration successful! Please check your email to verify your account.'),
            user: { id: user.id, email: user.email },
            id: user.id,
            userId: user.id,
            email_verification_required: !skip_verification_email && !isCompanyUser,
            email_verification_skipped: !!skip_verification_email || isCompanyUser,
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
            sendVerificationEmail(trimmedAdminEmail, admin_full_name.trim(), verificationToken)
                .then(sent => {
                    if (sent) console.log(`✅ [Company Registration] Verification email successfully sent to ${trimmedAdminEmail}`);
                    else console.error(`❌ [Company Registration] Failed to send verification email to ${trimmedAdminEmail}`);
                })
                .catch(err => {
                    console.error('❌ [Company Registration] Error sending verification email:', err);
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

        // Always check users table first to get the DB truth for account_type
        const { data: dbUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

        // Determine actual account type from DB (not JWT)
        const dbAccountType = dbUser?.account_type || account_type || 'individual';
        const isPlanIndividual = dbUser?.subscription_plan && dbUser.subscription_plan.startsWith('individual');
        const isIndividualInDb = dbAccountType === 'individual' || isPlanIndividual;

        if (!isIndividualInDb && (account_type === 'company_user' || req.user.user_type === 'company_user')) {
            const { data } = await supabase.from('company_users').select('*').eq('id', userId).maybeSingle();
            if (data) user = { ...data, user_type: 'company_user', account_type: 'company_user' };
        }

        if (!user && dbUser) {
            user = { ...dbUser, user_type: 'regular_user' };
        }

        if (!user) { // Fallback
            const { data: cu } = await supabase.from('company_users').select('*').eq('id', userId).maybeSingle();
            if (cu) user = { ...cu, user_type: 'company_user', account_type: 'company_user' };
        }

        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        // Override with DB truth — if DB says individual, respect it
        if (isIndividualInDb) {
            user.account_type = 'individual';
            user.company_id = null;
            if (user.role === 'company_admin') user.role = 'user';
        }

        // Robust company identification — ONLY for non-individual users
        if (!user.company_id && !isIndividualInDb) {
            const { data: employeeRecord } = await supabase
                .from('company_users')
                .select('company_id')
                .ilike('email', user.email.trim().toLowerCase())
                .maybeSingle();

            if (employeeRecord && employeeRecord.company_id) {
                user.company_id = employeeRecord.company_id;
                user.is_shared_account = true;
            } else if (user.role === 'company_admin' || user.account_type === 'company') {
                const { data: compFound } = await supabase
                    .from('companies')
                    .select('id')
                    .or(`admin_email.ilike.${user.email.trim().toLowerCase()},admin_id.eq.${user.id}`)
                    .maybeSingle();
                if (compFound && compFound.id) {
                    user.company_id = compFound.id;
                }
            }
        }

        // Safety fallback: If still no company_id and marked company_admin, revert to individual
        if (!user.company_id && user.role === 'company_admin') {
            user.role = 'user';
            user.account_type = 'individual';
        }

        let companyData = null;
        if (user.company_id && !isIndividualInDb) {
            const { data } = await supabase.from('companies').select('*').eq('id', user.company_id).maybeSingle();
            companyData = data;
        }

        // Check if we should inherit subscription status from company
        let hasCompanySubscription = !isIndividualInDb && companyData && companyData.subscription_status === 'active';

        // Backup check in subscriptions history if company record is out of sync
        if (user.company_id && !isIndividualInDb && !hasCompanySubscription) {
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
                companyData = companyData || { id: user.company_id };
                companyData.subscription_status = 'active';
                companyData.subscription_plan = activeSub.plan_id;
                companyData.subscription_end_date = activeSub.end_date;
            }
        }

        const isCompanyAdmin = !isIndividualInDb && !!user.company_id && (user.role === 'company_admin' || user.account_type === 'company');
        const isEffectivelyCompanyUser = !isIndividualInDb && !isCompanyAdmin && (user.user_type === 'company_user' || !!user.company_id);
        const effectiveRole = (!user.company_id && user.role === 'company_admin') ? 'user' : (isIndividualInDb && user.role === 'company_admin' ? 'user' : (user.role || 'user'));

        // Get patient limit info for the user
        const mockUser = {
            role: effectiveRole,
            account_type: isIndividualInDb ? 'individual' : (isCompanyAdmin ? 'company' : (user.account_type || (isEffectivelyCompanyUser ? 'company_user' : 'individual'))),
            company_id: isIndividualInDb ? null : user.company_id,
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
            role: effectiveRole,
            account_type: isIndividualInDb ? 'individual' : (isCompanyAdmin ? 'company' : (isEffectivelyCompanyUser ? 'company_user' : (user.account_type || 'individual'))),
            phone: user.phone,
            approved: user.approved,
            institution: user.institution || (companyData ? companyData.company_name : ''),
            country: user.country,
            region: user.region,
            company: isIndividualInDb ? null : companyData,
            company_id: isIndividualInDb ? null : user.company_id,
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

        res.json({ success: true, user: userResponse, user_type: isIndividualInDb ? 'regular_user' : user.user_type });
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

        // Send the reset email
        const emailSent = await sendPasswordResetEmail(cleanEmail, user.full_name || 'User', token);
        
        if (!emailSent) {
            return res.status(500).json({ success: false, error: 'Failed to send password reset email. Please try again later.' });
        }

        res.json({
            success: true,
            message: 'A password reset link has been sent to your email.'
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
            console.error('Resend verification failed: User not found in database for email:', cleanEmail);
            return res.json({
                success: false,
                error: 'User not found in the database. Please check the email address.'
            });
        }

        // Company users and already verified users do not require email verification
        if (user.email_verified || table === 'company_users' || user.account_type === 'company_user' || user.company_id) {
            return res.json({
                success: true,
                message: 'Company users are pre-verified by their company administrator. You can log in directly.',
                already_verified: true
            });
        }

        // Generate new verification token
        const verificationToken = generateToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

        // Update user with new token
        const { error: updateError } = await db.from(table).update({
            email_verification_token: verificationToken,
            email_verification_expires: verificationExpires,
            updated_at: new Date().toISOString()
        }).eq('id', user.id);

        if (updateError) {
            console.error('Failed to update verification token:', updateError);
            return res.status(500).json({ success: false, error: 'Database update failed. Cannot generate new token.' });
        }

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
            message: `Verification email sent! Link: ${config.frontendUrl}/verify-email?token=${verificationToken}`
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
