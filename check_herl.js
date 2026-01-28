import { supabase } from './src/config/supabase.js';

async function checkHerl() {
    console.log('=== Checking herl@gmail.com ===\n');

    // 1. Check users table
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('email', 'herl@gmail.com')
        .maybeSingle();

    console.log('1. User record:', user ? {
        id: user.id,
        email: user.email,
        company_id: user.company_id,
        subscription_status: user.subscription_status,
        subscription_end_date: user.subscription_end_date
    } : 'NOT FOUND');

    // 2. Check company_users table
    const { data: companyUser } = await supabase
        .from('company_users')
        .select('*')
        .eq('email', 'herl@gmail.com')
        .maybeSingle();

    console.log('\n2. Company user record:', companyUser ? {
        id: companyUser.id,
        email: companyUser.email,
        company_id: companyUser.company_id,
        subscription_status: companyUser.subscription_status
    } : 'NOT FOUND');

    // 3. Check company if found
    const companyId = user?.company_id || companyUser?.company_id;
    if (companyId) {
        const { data: company } = await supabase
            .from('companies')
            .select('*')
            .eq('id', companyId)
            .maybeSingle();

        console.log('\n3. Company record:', company ? {
            id: company.id,
            company_name: company.company_name,
            subscription_status: company.subscription_status,
            subscription_plan: company.subscription_plan,
            subscription_end_date: company.subscription_end_date
        } : 'NOT FOUND');

        // 4. Check subscriptions table
        const { data: subs } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false });

        console.log('\n4. Subscription records for company:', subs?.length || 0);
        if (subs && subs.length > 0) {
            subs.forEach((sub, i) => {
                console.log(`   [${i}]`, {
                    status: sub.status,
                    plan: sub.plan_name,
                    end_date: sub.end_date,
                    created: sub.created_at
                });
            });
        }
    } else {
        console.log('\n3. No company_id found for this user');
    }

    console.log('\n=== End Check ===');
    process.exit(0);
}

checkHerl().catch(console.error);
