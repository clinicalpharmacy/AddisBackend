import express from 'express';
import axios from 'axios';
import bcrypt from 'bcryptjs';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/env.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { getPlanDetails, calculateEndDate } from '../utils/helpers.js';
import { sendVerificationEmail } from '../utils/emailService.js';

const router = express.Router();
const CHAPA_BASE_URL = config.chapa.baseUrl || 'https://api.chapa.co/v1';
const CHAPA_SECRET_KEY = config.chapa.secretKey;

// Create Payment
router.post('/chapa/create-payment', async (req, res) => {
    try {
        let { planId, userEmail, userName, userPhone, userId, account_type, frontendUrl, client_password } = req.body;
        if (!planId || !userEmail) return res.status(400).json({ error: 'Missing planId or email' });

        userEmail = userEmail.trim().toLowerCase();
        // Use provided frontendUrl or fallback to config
        const baseFrontendUrl = frontendUrl || config.frontendUrl || 'http://localhost:5173';
        const baseBackendUrl = process.env.BACKEND_URL || 'http://localhost:3000';

        const planDetails = getPlanDetails(planId);
        if (!planDetails) {
            console.warn(`⚠️ Invalid plan selection: ${planId}`);
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const tx_ref = `pharma_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const nameParts = (userName || 'User').split(' ');

        const paymentData = {
            amount: planDetails.price.toString(),
            currency: 'ETB',
            email: userEmail,
            first_name: nameParts[0] || 'User',
            last_name: nameParts.slice(1).join(' ') || 'User',
            tx_ref: tx_ref,
            callback_url: `${baseBackendUrl}/api/chapa/webhook`,
            return_url: `${baseFrontendUrl}/subscription/success?tx_ref=${tx_ref}&status=success`,
            customization: { title: 'PharmaCare', description: planDetails.name.substring(0, 100) }
        };

        console.log(`ℹ️ Initializing Chapa payment for ${userEmail} (Plan: ${planId}, Ref: ${tx_ref})`);

        const response = await axios.post(`${CHAPA_BASE_URL}/transaction/initialize`, paymentData, {
            headers: { 'Authorization': `Bearer ${CHAPA_SECRET_KEY}`, 'Content-Type': 'application/json' },
            timeout: 15000
        });

        if (response.data.status !== 'success') {
            console.error('❌ Chapa Initialization Failed:', response.data);
            return res.status(400).json({ error: response.data.message || 'Gateway error' });
        }

        const isHealthcareClient = userEmail.includes('@hcc.addis-med.com');
        const dbUserId = isHealthcareClient ? null : userId;

        console.log(`ℹ️ Recording pending payment in DB (HC Client: ${isHealthcareClient})`);

        const db = supabaseAdmin || supabase;
        const { error: insertError } = await db.from('payments').insert([{
            user_id: dbUserId || null,
            user_email: userEmail,
            user_name: userName || 'User',
            user_phone: userPhone || null,
            tx_ref,
            plan_id: planId,
            plan_name: planDetails.name,
            amount: planDetails.price,
            currency: 'ETB',
            status: 'pending',
            payment_method: 'chapa',
            payment_url: response.data.data.checkout_url,
            account_type: account_type || 'individual',
            gateway_response: {
                ...response.data,
                is_healthcare_client: isHealthcareClient,
                healthcare_client_id: isHealthcareClient ? userEmail.split('@')[0] : null,
                client_password: client_password || null
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }]);

        if (insertError) {
            console.error('❌ Database Insert Failed. Details:', JSON.stringify(insertError, null, 2));
            throw new Error(`Database error: ${insertError.message || 'Unknown error'}`);
        }

        console.log('✅ Payment initialization successful, returning checkout URL');
        res.json({ success: true, payment_url: response.data.data.checkout_url, tx_ref, amount: planDetails.price, user_phone: userPhone });
    } catch (e) {
        // Log EVERYTHING for debugging the 500 error
        const rawError = e.response?.data;
        let errorMsg = rawError?.message || e.message;

        // Handle nested error objects (like Chapa validation errors)
        if (errorMsg && typeof errorMsg === 'object') {
            errorMsg = JSON.stringify(errorMsg);
        }

        const errorDetails = e.response?.data || null;

        console.error('❌ CREATE-PAYMENT ERROR:', errorMsg);

        res.status(500).json({
            success: false,
            error: String(errorMsg),
            details: errorDetails ? (typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : String(errorDetails)) : null
        });
    }
});

// Webhook
router.post('/chapa/webhook', express.json(), async (req, res) => {
    try {
        const { tx_ref, status } = req.body;
        if (!tx_ref) return res.status(400).json({ error: 'Missing tx_ref' });

        const db = supabaseAdmin || supabase;
        const { data: payment, error: fetchError } = await db.from('payments').select('*').eq('tx_ref', tx_ref).maybeSingle();
        if (fetchError || !payment) {
            console.error('❌ Payment record not found in webhook for tx_ref:', tx_ref);
            return res.status(404).json({ error: 'Not found' });
        }

        const updateData = { updated_at: new Date().toISOString(), gateway_response: req.body };
        const normalizedStatus = status?.toLowerCase();

        if (normalizedStatus === 'success') {
            updateData.status = 'paid';
            updateData.paid_at = new Date().toISOString();
            updateData.transaction_id = req.body.transaction_id;
        } else {
            updateData.status = 'failed';
        }

        const { error: updateError } = await db.from('payments').update(updateData).eq('id', payment.id);
        if (updateError) {
            console.error('❌ Failed to update payment status in webhook:', updateError.message);
        } else {
            console.log(`✅ Payment status updated to ${updateData.status} for tx_ref: ${tx_ref}`);
        }

        if (status?.toLowerCase() === 'success' && payment.user_email) {
            const cleanEmail = payment.user_email.trim().toLowerCase();

            // Healthcare clients use a temp email not stored in DB - create it now
            const isHealthcareClient = cleanEmail.includes('@hcc.addis-med.com');
            if (isHealthcareClient) {
                console.log(`ℹ️ Webhook: Healthcare client payment detected for ${cleanEmail} - Creating user account`);

                const clientId = cleanEmail.split('@')[0];
                const rawPassword = payment.gateway_response?.client_password || 'healthcare123';
                const hashedPassword = await bcrypt.hash(rawPassword, 10);
                const endDate = calculateEndDate(payment.plan_id);

                const { error: createError } = await db.from('users').upsert([{
                    email: cleanEmail,
                    password_hash: hashedPassword,
                    full_name: `Healthcare Client ${clientId}`,
                    phone: payment.user_phone || '0000000000',
                    role: 'healthcare_client',
                    account_type: 'individual',
                    country: 'Ethiopia',
                    region: 'N/A',
                    woreda: 'N/A',
                    tin_number: 'N/A',
                    email_verified: true,
                    approved: true,
                    subscription_status: 'active',
                    subscription_plan: payment.plan_id,
                    subscription_end_date: endDate,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }], { onConflict: 'email' });

                if (createError) {
                    console.error('❌ Webhook: Failed to create healthcare client user account:', JSON.stringify(createError, null, 2));
                } else {
                    console.log(`✅ Webhook: Healthcare client user created/updated successfully: ${cleanEmail}`);
                }

                return res.json({ success: true, message: 'Processed' });
            }

            let user = null;
            const { data: regularUser, error: userError } = await db.from('users').select('id, company_id, role, email, full_name, email_verified, email_verification_token').ilike('email', cleanEmail).maybeSingle();

            if (userError) {
                console.error('❌ User lookup error in webhook:', userError.message);
            }

            if (regularUser) {
                user = regularUser;
            } else {
                // Try company_users table as fallback
                const { data: cUser } = await db.from('company_users').select('id, company_id, role, email, full_name, email_verified, email_verification_token').ilike('email', cleanEmail).maybeSingle();
                if (cUser) {
                    console.log(`ℹ️ Webhook: Found user in company_users table: ${cleanEmail}`);
                    user = cUser;
                }
            }

            if (user) {
                console.log(`👤 Webhook: Processing user ${user.email} (ID: ${user.id})`);

                // 1. ENSURE TOKEN EXISTS
                let currentToken = user.email_verification_token;
                if (!user.email_verified && !currentToken) {
                    console.log(`🔑 Webhook: Generating missing verification token for ${user.email}`);
                    const newToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                    const targetTable = (await db.from('users').select('id').eq('id', user.id).maybeSingle()).data ? 'users' : 'company_users';
                    await db.from(targetTable).update({ email_verification_token: newToken, email_verification_expires: expires }).eq('id', user.id);
                    currentToken = newToken;
                }

                // 2. SEND EMAIL IMMEDIATELY (BLOCKING)
                if (!user.email_verified && currentToken) {
                    try {
                        console.log(`📧 Webhook: Sending verification email to: ${user.email} NOW...`);
                        const sent = await sendVerificationEmail(user.email, user.full_name, currentToken);
                        if (sent) console.log(`✅ Webhook: Email delivered to SMTP for ${user.email}`);
                        else console.error(`❌ Webhook: SMTP failed for ${user.email}`);
                    } catch (err) {
                        console.error('❌ Webhook: Email exception:', err.message);
                    }
                }

                // 3. BACKGROUND UPDATES (Subscriptions etc)
                const endDate = calculateEndDate(payment.plan_id || 'individual_monthly');
                const isCompanyType = payment.account_type === 'company' || user.role === 'company_admin';

                if (isCompanyType && user.company_id) {
                    // Update principal company record
                    await db.from('companies').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate,
                        updated_at: new Date().toISOString()
                    }).eq('id', user.company_id);

                    // Update all users in company (Admin + Employees)
                    await db.from('users').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate
                    }).eq('company_id', user.company_id);

                    await db.from('company_users').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate
                    }).eq('company_id', user.company_id);
                } else {
                    // Individual update - AUTO-APPROVE as they have paid
                    await db.from('users').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate,
                        approved: true // Individual users are auto-approved on payment
                    }).eq('id', user.id);
                }

                await db.from('subscriptions').insert([{
                    user_id: user.id,
                    company_id: user.company_id || null,
                    plan_id: payment.plan_id,
                    plan_name: payment.plan_name,
                    amount: payment.amount,
                    currency: payment.currency,
                    status: 'active',
                    payment_method: 'chapa',
                    tx_ref: tx_ref,
                    start_date: new Date().toISOString(),
                    end_date: endDate,
                    created_at: new Date().toISOString()
                }]);

                // (Email already sent above)
                console.log(`ℹ️ Webhook: DB Updates complete for ${user.email}`);
            } else {
                console.warn(`⚠️ Webhook: No user found with email ${cleanEmail}`);
            }
        }
        res.json({ success: true, message: 'Processed' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Verify
router.get('/payments/:tx_ref/verify', async (req, res) => {
    try {
        const { tx_ref } = req.params;
        const db = supabaseAdmin || supabase;
        const { data: payment, error: fetchError } = await db.from('payments').select('*').eq('tx_ref', tx_ref).maybeSingle();
        if (fetchError || !payment) {
            console.error('❌ Payment record not found in verify for tx_ref:', tx_ref);
            return res.status(404).json({ success: false, error: 'Not found', status: 'not_found' });
        }

        if (payment.status === 'paid') {
            return res.json({ success: true, payment, is_paid: true, status: 'paid' });
        }

        if (payment.status === 'pending') {
            try {
                const check = await axios.get(`${CHAPA_BASE_URL}/transaction/verify/${tx_ref}`, {
                    headers: { 'Authorization': `Bearer ${CHAPA_SECRET_KEY}` }
                });
                const normalizedStatus = check.data.status?.toLowerCase();
                const normalizedGatewayStatus = check.data.data?.status?.toLowerCase();

                if (normalizedStatus === 'success' && normalizedGatewayStatus === 'success') {
                    // Update DB for payment
                    const endDate = calculateEndDate(payment.plan_id || 'individual_monthly');
                    const updates = {
                        status: 'paid',
                        paid_at: new Date().toISOString(),
                        transaction_id: check.data.data.id,
                        gateway_response: check.data,
                        updated_at: new Date().toISOString()
                    };
                    const { error: updateError } = await db.from('payments').update(updates).eq('id', payment.id);
                    if (updateError) {
                        console.error('❌ Failed to update payment status in verify:', updateError.message);
                    } else {
                        console.log(`✅ Payment status updated to paid in verify for tx_ref: ${tx_ref}`);
                    }

                    // Update User(s) Subscription Access
                    if (payment.user_email) {
                        const cleanEmail = payment.user_email.trim().toLowerCase();

                        // Healthcare clients use a temp email - create user record if missing
                        const isHealthcareClient = cleanEmail.includes('@hcc.addis-med.com');
                        if (isHealthcareClient) {
                            console.log(`ℹ️ Verify: Healthcare client payment - Creating user account`);

                            const clientId = cleanEmail.split('@')[0];
                            const rawPassword = payment.gateway_response?.client_password || 'healthcare123';
                            const hashedPassword = await bcrypt.hash(rawPassword, 10);

                            const { error: upsertError } = await db.from('users').upsert([{
                                email: cleanEmail,
                                password_hash: hashedPassword,
                                full_name: `Healthcare Client ${clientId}`,
                                phone: payment.user_phone || '0000000000',
                                role: 'healthcare_client',
                                account_type: 'individual',
                                country: 'Ethiopia',
                                region: 'N/A',
                                woreda: 'N/A',
                                tin_number: 'N/A',
                                email_verified: true,
                                approved: true,
                                subscription_status: 'active',
                                subscription_plan: payment.plan_id,
                                subscription_end_date: endDate,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            }], { onConflict: 'email' });

                            if (upsertError) {
                                console.error('❌ Verify: Failed to create healthcare client user account:', JSON.stringify(upsertError, null, 2));
                                return res.status(500).json({
                                    success: false,
                                    error: 'Account creation failed after payment. Please contact support.',
                                    details: upsertError.message
                                });
                            }
                            console.log(`✅ Verify: Healthcare client user created successfully: ${cleanEmail}`);

                            return res.json({
                                success: true,
                                payment: { ...payment, ...updates, subscription_end_date: endDate },
                                is_paid: true,
                                status: 'paid',
                                subscription_end_date: endDate,
                                is_healthcare_client: true
                            });
                        }

                        let user = null;
                        const { data: regularUser, error: userError } = await db.from('users').select('id, company_id, role, email, full_name, email_verified, email_verification_token').ilike('email', cleanEmail).maybeSingle();

                        if (userError) {
                            console.error('❌ User lookup error in payment verify:', userError.message);
                        }

                        if (regularUser) {
                            user = regularUser;
                        } else {
                            // Try company_users table as fallback
                            const { data: cUser } = await db.from('company_users').select('id, company_id, role, email, full_name, email_verified, email_verification_token').ilike('email', cleanEmail).maybeSingle();
                            if (cUser) {
                                console.log(`ℹ️ Verify: Found user in company_users table: ${cleanEmail}`);
                                user = cUser;
                            }
                        }

                        if (user) {
                            console.log(`👤 Verify: Processing user ${user.email} (ID: ${user.id})`);

                            // 1. ENSURE TOKEN EXISTS
                            let currentToken = user.email_verification_token;
                            if (!user.email_verified && !currentToken) {
                                console.log(`🔑 Verify: Generating missing verification token for ${user.email}`);
                                const newToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                                const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                                const targetTable = (await db.from('users').select('id').eq('id', user.id).maybeSingle()).data ? 'users' : 'company_users';
                                await db.from(targetTable).update({ email_verification_token: newToken, email_verification_expires: expires }).eq('id', user.id);
                                currentToken = newToken;
                            }

                            // 2. SEND EMAIL IMMEDIATELY (BLOCKING)
                            if (!user.email_verified && currentToken) {
                                try {
                                    console.log(`📧 Verify: Sending verification email to: ${user.email} NOW...`);
                                    const sent = await sendVerificationEmail(user.email, user.full_name, currentToken);
                                    if (sent) console.log(`✅ Verify: Email delivered to SMTP for ${user.email}`);
                                    else console.error(`❌ Verify: SMTP failed for ${user.email}`);
                                } catch (err) {
                                    console.error('❌ Verify: Email exception:', err.message);
                                }
                            }

                            // 3. BACKGROUND UPDATES (Subscriptions etc)
                            const isCompanyType = payment.account_type === 'company' || user.role === 'company_admin';

                            if (isCompanyType && user.company_id) {
                                // 0. Update principal company record
                                await db.from('companies').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate,
                                    updated_at: new Date().toISOString()
                                }).eq('id', user.company_id);

                                // 1. Update Company Admin & any other users in 'users' table with this company_id
                                await db.from('users').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate
                                }).eq('company_id', user.company_id);

                                // 2. Update all employees in 'company_users' table
                                await db.from('company_users').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate
                                }).eq('company_id', user.company_id);
                            } else {
                                // Individual update - AUTO-APPROVE as they have paid
                                await db.from('users').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate,
                                    approved: true // Individual users are auto-approved on payment
                                }).eq('id', user.id);
                            }

                            // Record in subscriptions history
                            await db.from('subscriptions').insert([{
                                user_id: user.id,
                                company_id: user.company_id || null,
                                plan_id: payment.plan_id,
                                plan_name: payment.plan_name,
                                amount: payment.amount,
                                currency: payment.currency,
                                status: 'active',
                                payment_method: 'chapa',
                                tx_ref: tx_ref,
                                start_date: new Date().toISOString(),
                                end_date: endDate,
                                created_at: new Date().toISOString()
                            }]);

                            // Send Verification Email if not verified
                            if (!user.email_verified && currentToken) {
                                console.log(`📧 Verify: Sending verification email to: ${user.email}`);
                                sendVerificationEmail(user.email, user.full_name, currentToken).then(sent => {
                                    if (sent) console.log(`✅ Verify: Email sent to ${user.email}`);
                                    else console.error(`❌ Verify: Failed to send email to ${user.email}`);
                                }).catch(err => {
                                    console.error('❌ Verify: Email sending exception:', err);
                                });
                            } else {
                                console.log(`ℹ️ Verify: Email skipped: verified=${user.email_verified}, token=${!!currentToken}`);
                            }
                        } else {
                            console.warn(`⚠️ Verify: No user found with email ${cleanEmail}`);
                        }
                    }
                    return res.json({
                        success: true,
                        payment: { ...payment, ...updates, subscription_end_date: endDate },
                        is_paid: true,
                        status: 'paid',
                        subscription_end_date: endDate
                    });
                }
            } catch (e) {
                // validation failed
                console.error("Verification logic error:", e.message);
            }
        }

        // If already paid, also try to return end date for convenience
        let subscription_end_date = null;
        if (payment.status === 'paid' && payment.user_email) {
            const cleanEmail = payment.user_email.trim().toLowerCase();
            const { data: user } = await db.from('users').select('subscription_end_date').ilike('email', cleanEmail).maybeSingle();
            subscription_end_date = user?.subscription_end_date;
        }

        res.json({
            success: true,
            payment: { ...payment, subscription_end_date },
            is_paid: payment.status === 'paid',
            status: payment.status,
            subscription_end_date
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/chapa/verify/:tx_ref', authenticateToken, async (req, res) => {
    // Duplicate functionality essentially, but specific to authenticated user?
    // Redirect to logic above or reimplement
    res.redirect(`../../payments/${req.params.tx_ref}/verify`);
});

router.post('/admin/fix-payments', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { data: pending } = await supabase.from('payments').select('*').eq('status', 'pending');
        for (const p of pending || []) {
            await supabase.from('payments').update({ status: 'paid', paid_at: p.created_at, updated_at: new Date().toISOString() }).eq('id', p.id);
        }
        res.json({ success: true, message: 'Fixed', count: pending?.length || 0 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/payments/my-payments', authenticateToken, async (req, res) => {
    try {
        const { data } = await supabase.from('payments').select('*').eq('user_id', req.user.userId).order('created_at', { ascending: false });
        res.json({ success: true, payments: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/subscriptions/my-subscriptions', authenticateToken, async (req, res) => {
    try {
        const { data } = await supabase.from('subscriptions').select('*').eq('user_id', req.user.userId).order('created_at', { ascending: false });
        res.json({ success: true, subscriptions: data || [] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
