-- DIRECT FIX FOR KS@GMAIL.COM
-- Force activate this user directly

-- Check current state
SELECT 'BEFORE:' as status, email, company_id, subscription_status, subscription_plan, subscription_end_date
FROM company_users WHERE email = 'ks@gmail.com';

-- Force activate
UPDATE company_users
SET 
    subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_end_date = (NOW() + INTERVAL '1 year')::timestamp,
    updated_at = NOW()
WHERE email = 'ks@gmail.com';

-- Also check if ks exists in users table
UPDATE users
SET 
    subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_end_date = (NOW() + INTERVAL '1 year')::timestamp,
    updated_at = NOW()
WHERE email = 'ks@gmail.com';

-- Verify
SELECT 'AFTER:' as status, email, company_id, subscription_status, subscription_plan, subscription_end_date
FROM company_users WHERE email = 'ks@gmail.com'
UNION ALL
SELECT 'AFTER:' as status, email, company_id, subscription_status, subscription_plan, subscription_end_date
FROM users WHERE email = 'ks@gmail.com';
