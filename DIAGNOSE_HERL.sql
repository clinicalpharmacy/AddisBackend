-- DIAGNOSTIC: Find out why herl is still inactive
-- Run this in Supabase SQL Editor

-- 1. Check if herl exists and where
SELECT '1. HERL IN USERS TABLE:' as step;
SELECT id, email, company_id, subscription_status, subscription_plan, subscription_end_date, account_type
FROM users 
WHERE email = 'herl@gmail.com';

SELECT '2. HERL IN COMPANY_USERS TABLE:' as step;
SELECT id, email, company_id, subscription_status, subscription_plan, subscription_end_date, account_type
FROM company_users 
WHERE email = 'herl@gmail.com';

-- 3. Find herl's company (if any)
SELECT '3. HERLS COMPANY:' as step;
SELECT c.*
FROM companies c
WHERE c.id IN (
    SELECT company_id FROM users WHERE email = 'herl@gmail.com' AND company_id IS NOT NULL
    UNION
    SELECT company_id FROM company_users WHERE email = 'herl@gmail.com' AND company_id IS NOT NULL
);

-- 4. Check ALL companies with active subscriptions
SELECT '4. ALL ACTIVE COMPANIES:' as step;
SELECT id, company_name, subscription_status, subscription_plan, subscription_end_date, admin_id
FROM companies
WHERE subscription_status = 'active';

-- 5. Check if there are ANY active subscriptions in the subscriptions table
SELECT '5. ACTIVE SUBSCRIPTIONS IN BILLING:' as step;
SELECT id, user_id, company_id, plan_name, status, end_date, created_at
FROM subscriptions
WHERE status = 'active' 
AND end_date > NOW()
ORDER BY created_at DESC
LIMIT 10;

-- 6. Check all users in herl's company (if she has one)
SELECT '6. ALL USERS IN HERLS COMPANY:' as step;
SELECT cu.email, cu.subscription_status, cu.account_type
FROM company_users cu
WHERE cu.company_id IN (
    SELECT company_id FROM users WHERE email = 'herl@gmail.com' AND company_id IS NOT NULL
    UNION
    SELECT company_id FROM company_users WHERE email = 'herl@gmail.com' AND company_id IS NOT NULL
);
