import fetch from 'node-fetch';

const BACKEND_URL = 'http://localhost:3000';

async function testHerlAuth() {
    console.log('=== Testing herl@gmail.com Authentication ===\n');

    try {
        // 1. Login
        console.log('1. Attempting login...');
        const loginResponse = await fetch(`${BACKEND_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'herl@gmail.com',
                password: 'herl123' // You may need to adjust this
            })
        });

        const loginData = await loginResponse.json();

        if (!loginData.success) {
            console.log('❌ Login failed:', loginData.error);
            return;
        }

        console.log('✅ Login successful');
        console.log('User data:', {
            email: loginData.user.email,
            company_id: loginData.user.company_id,
            account_type: loginData.user.account_type,
            subscription_status: loginData.user.subscription_status,
            subscription_plan: loginData.user.subscription_plan,
            subscription_end_date: loginData.user.subscription_end_date
        });

        // 2. Test /auth/me endpoint
        console.log('\n2. Testing /auth/me endpoint...');
        const meResponse = await fetch(`${BACKEND_URL}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${loginData.token}`
            }
        });

        const meData = await meResponse.json();

        if (meData.success) {
            console.log('✅ /auth/me successful');
            console.log('Profile data:', {
                email: meData.user.email,
                company_id: meData.user.company_id,
                account_type: meData.user.account_type,
                subscription_status: meData.user.subscription_status,
                subscription_plan: meData.user.subscription_plan,
                subscription_end_date: meData.user.subscription_end_date,
                company: meData.user.company ? {
                    name: meData.user.company.company_name,
                    subscription_status: meData.user.company.subscription_status
                } : null
            });
        } else {
            console.log('❌ /auth/me failed:', meData.error);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('\n⚠️ Make sure the backend server is running on port 3000');
    }
}

testHerlAuth();
