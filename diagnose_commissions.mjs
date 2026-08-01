import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function diagnose() {
    console.log('\n=== PROMOTION SYSTEM DIAGNOSTIC ===\n');

    // 1. Check if commissions table exists
    console.log('1. Checking commissions table...');
    const { data: commData, error: commErr } = await supabase.from('commissions').select('*').limit(5);
    if (commErr) {
        console.log('   ❌ COMMISSIONS TABLE ERROR:', commErr.message);
        console.log('   >>> You need to run ADD_PROMOTION_SYSTEM.sql in your Supabase SQL Editor!');
    } else {
        console.log('   ✅ Commissions table exists. Rows:', commData?.length || 0);
        if (commData?.length > 0) console.log('   Data:', JSON.stringify(commData, null, 2));
    }

    // 2. Find Account A (the referrer with code WEN7933)
    console.log('\n2. Looking up referrer with promotion_code = WEN7933...');
    const { data: referrer, error: refErr } = await supabase.from('users')
        .select('id, email, full_name, promotion_code')
        .eq('promotion_code', 'WEN7933')
        .maybeSingle();

    if (refErr) console.log('   ❌ Error:', refErr.message);
    if (!referrer) {
        console.log('   ❌ No user found with promotion_code WEN7933!');
        console.log('   >>> The promotion_code column may not exist. Run ADD_PROMOTION_SYSTEM.sql!');
    } else {
        console.log('   ✅ Found referrer:', referrer.email, '(ID:', referrer.id, ')');

        // 3. Check if anyone was referred by this user
        console.log('\n3. Checking if any user has referred_by_id pointing to this referrer...');
        const { data: referred, error: refByErr } = await supabase.from('users')
            .select('id, email, full_name, referred_by_id, created_at')
            .eq('referred_by_id', referrer.id);

        if (refByErr) console.log('   ❌ Error:', refByErr.message);
        else if (!referred || referred.length === 0) {
            console.log('   ❌ No users have referred_by_id = ', referrer.id);
            console.log('   >>> This means the referral code was NOT saved during registration.');
            console.log('   >>> The new user was likely registered BEFORE the code was deployed to Vercel.');
        } else {
            console.log('   ✅ Found', referred.length, 'referred user(s):');
            referred.forEach(u => console.log('      -', u.email, '(ID:', u.id, ', created:', u.created_at, ')'));
        }

        // 4. Check commissions for this referrer
        console.log('\n4. Checking commissions for referrer ID:', referrer.id);
        const { data: userComm, error: ucErr } = await supabase.from('commissions')
            .select('*')
            .eq('user_id', referrer.id);

        if (ucErr) console.log('   ❌ Error:', ucErr.message);
        else if (!userComm || userComm.length === 0) {
            console.log('   ❌ No commission records found for this user.');
        } else {
            console.log('   ✅ Found', userComm.length, 'commission record(s):');
            userComm.forEach(c => console.log('      - Amount:', c.amount, 'Status:', c.status));
        }
    }

    // 5. Check recent payments
    console.log('\n5. Checking last 3 payments...');
    const { data: payments } = await supabase.from('payments')
        .select('id, user_email, status, amount, gateway_response')
        .order('created_at', { ascending: false })
        .limit(3);

    if (payments) {
        payments.forEach(p => {
            console.log('   Payment:', p.user_email, '| Status:', p.status, '| Amount:', p.amount);
            console.log('   Referral code in gateway_response:', p.gateway_response?.referral_code || 'NOT SET');
        });
    }

    console.log('\n=== DIAGNOSTIC COMPLETE ===\n');
}

diagnose().catch(console.error);
