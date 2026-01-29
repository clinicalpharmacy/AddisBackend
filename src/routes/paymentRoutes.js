import express from 'express';
import axios from 'axios';
import { supabase } from '../config/supabase.js';
import { authenticateToken, requireAdmin } from '../middleware/authMiddleware.js';
import { getPlanDetails, calculateEndDate } from '../utils/helpers.js';

const router = express.Router();
const CHAPA_BASE_URL = 'https://api.chapa.co/v1';
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY;

// Create Payment
router.post('/chapa/create-payment', async (req, res) => {
    try {
        let { planId, userEmail, userName, userPhone, userId, account_type, frontendUrl } = req.body;
        if (!planId || !userEmail) return res.status(400).json({ error: 'Missing planId or email' });

        userEmail = userEmail.trim().toLowerCase();
        // Use provided frontendUrl or fallback to env or default
        const baseFrontendUrl = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
        const baseBackendUrl = process.env.BACKEND_URL || 'http://localhost:3000';

        const planDetails = getPlanDetails(planId);
        if (!planDetails) return res.status(400).json({ error: 'Invalid plan' });

        const tx_ref = `pharma_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const nameParts = (userName || 'User').split(' ');

        const paymentData = {
            amount: planDetails.price.toString(),
            currency: 'ETB',
            email: userEmail,
            first_name: nameParts[0] || 'User',
            last_name: nameParts.slice(1).join(' ') || 'User',
            tx_ref: tx_ref,
            // Callback needs to be the BACKEND URL for the webhook to work
            callback_url: `${baseBackendUrl}/api/chapa/webhook`,
            // Return needs to be where the USER is currently browsing
            return_url: `${baseFrontendUrl}/subscription/success?tx_ref=${tx_ref}&status=success`,
            customization: { title: 'PharmaCare', description: planDetails.name.substring(0, 100) }
        };

        const response = await axios.post(`${CHAPA_BASE_URL}/transaction/initialize`, paymentData, {
            headers: { 'Authorization': `Bearer ${CHAPA_SECRET_KEY}`, 'Content-Type': 'application/json' },
            timeout: 15000
        });

        if (response.data.status !== 'success') return res.status(400).json({ error: response.data.message || 'Gateway error' });

        await supabase.from('payments').insert([{
            user_id: userId || null, user_email: userEmail, user_name: userName || 'User', user_phone: userPhone || null,
            tx_ref, plan_id: planId, plan_name: planDetails.name, amount: planDetails.price, currency: 'ETB',
            status: 'pending', payment_method: 'chapa', payment_url: response.data.data.checkout_url, account_type: account_type || 'individual',
            gateway_response: response.data, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        }]);

        res.json({ success: true, payment_url: response.data.data.checkout_url, tx_ref, amount: planDetails.price, user_phone: userPhone });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Webhook
router.post('/chapa/webhook', express.json(), async (req, res) => {
    try {
        const { tx_ref, status } = req.body;
        if (!tx_ref) return res.status(400).json({ error: 'Missing tx_ref' });

        const { data: payment } = await supabase.from('payments').select('*').eq('tx_ref', tx_ref).single();
        if (!payment) return res.status(404).json({ error: 'Not found' });

        const updateData = { updated_at: new Date().toISOString(), gateway_response: req.body };
        if (status === 'success') {
            updateData.status = 'paid';
            updateData.paid_at = new Date().toISOString();
            updateData.transaction_id = req.body.transaction_id;
        } else {
            updateData.status = 'failed';
        }

        await supabase.from('payments').update(updateData).eq('id', payment.id);

        if (status === 'success' && payment.user_email) {
            const cleanEmail = payment.user_email.trim().toLowerCase();
            const { data: user } = await supabase.from('users').select('id, company_id, role').ilike('email', cleanEmail).single();

            if (user) {
                const endDate = calculateEndDate(payment.plan_id || 'individual_monthly');
                const isCompanyType = payment.account_type === 'company' || user.role === 'company_admin';

                if (isCompanyType && user.company_id) {
                    // Update principal company record
                    await supabase.from('companies').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate,
                        updated_at: new Date().toISOString()
                    }).eq('id', user.company_id);

                    // Update all users in company (Admin + Employees)
                    await supabase.from('users').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate
                    }).eq('company_id', user.company_id);

                    await supabase.from('company_users').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate
                    }).eq('company_id', user.company_id);
                } else {
                    // Individual update
                    await supabase.from('users').update({
                        subscription_status: 'active',
                        subscription_plan: payment.plan_id,
                        subscription_end_date: endDate
                    }).eq('id', user.id);
                }

                await supabase.from('subscriptions').insert([{
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
        const { data: payment } = await supabase.from('payments').select('*').eq('tx_ref', tx_ref).single();
        if (!payment) return res.status(404).json({ success: false, error: 'Not found', status: 'not_found' });

        if (payment.status === 'paid') {
            return res.json({ success: true, payment, is_paid: true, status: 'paid' });
        }

        if (payment.status === 'pending') {
            try {
                const check = await axios.get(`${CHAPA_BASE_URL}/transaction/verify/${tx_ref}`, {
                    headers: { 'Authorization': `Bearer ${CHAPA_SECRET_KEY}` }
                });
                if (check.data.status === 'success' && check.data.data?.status === 'success') {
                    // Update DB for payment
                    const endDate = calculateEndDate(payment.plan_id || 'individual_monthly');
                    const updates = {
                        status: 'paid',
                        paid_at: new Date().toISOString(),
                        transaction_id: check.data.data.id,
                        gateway_response: check.data,
                        updated_at: new Date().toISOString()
                    };
                    await supabase.from('payments').update(updates).eq('id', payment.id);

                    // Update User(s) Subscription Access
                    if (payment.user_email) {
                        const cleanEmail = payment.user_email.trim().toLowerCase();
                        const { data: user } = await supabase.from('users').select('id, company_id, role').ilike('email', cleanEmail).single();

                        if (user) {
                            const isCompanyType = payment.account_type === 'company' || user.role === 'company_admin';

                            if (isCompanyType && user.company_id) {
                                // 0. Update principal company record
                                await supabase.from('companies').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate,
                                    updated_at: new Date().toISOString()
                                }).eq('id', user.company_id);

                                // 1. Update Company Admin & any other users in 'users' table with this company_id
                                await supabase.from('users').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate
                                }).eq('company_id', user.company_id);

                                // 2. Update all employees in 'company_users' table
                                await supabase.from('company_users').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate
                                }).eq('company_id', user.company_id);
                            } else {
                                // Individual update
                                await supabase.from('users').update({
                                    subscription_status: 'active',
                                    subscription_plan: payment.plan_id,
                                    subscription_end_date: endDate
                                }).eq('id', user.id);
                            }

                            // Record in subscriptions history
                            await supabase.from('subscriptions').insert([{
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
            }
        }

        // If already paid, also try to return end date for convenience
        let subscription_end_date = null;
        if (payment.status === 'paid' && payment.user_email) {
            const cleanEmail = payment.user_email.trim().toLowerCase();
            const { data: user } = await supabase.from('users').select('subscription_end_date').ilike('email', cleanEmail).single();
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
