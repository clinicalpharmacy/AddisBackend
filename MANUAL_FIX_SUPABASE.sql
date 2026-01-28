-- MANUAL FIX FOR HERL@GMAIL.COM
-- Copy and paste this into Supabase SQL Editor

-- Step 1: Check current status
SELECT 'Before Fix:' as status, email, company_id, subscription_status 
FROM users WHERE email = 'herl@gmail.com'
UNION ALL
SELECT 'Before Fix:' as status, email, company_id, subscription_status 
FROM company_users WHERE email = 'herl@gmail.com';

-- Step 2: Update herl in users table (if she exists there)
UPDATE users u
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE u.email = 'herl@gmail.com'
AND u.company_id = c.id;

-- Step 3: Update herl in company_users table (if she exists there)
UPDATE company_users cu
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE cu.email = 'herl@gmail.com'
AND cu.company_id = c.id;

-- Step 4: Update ALL company users from their company's subscription
UPDATE company_users cu
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE cu.company_id = c.id
AND c.subscription_status = 'active'
AND (cu.subscription_status IS NULL OR cu.subscription_status != 'active');

-- Step 5: Verify the fix
SELECT 'After Fix:' as status, email, company_id, subscription_status, subscription_plan
FROM users WHERE email = 'herl@gmail.com'
UNION ALL
SELECT 'After Fix:' as status, email, company_id, subscription_status, subscription_plan
FROM company_users WHERE email = 'herl@gmail.com';

-- Step 6: Show all company users with active subscriptions
SELECT 'All Active Company Users:' as info, email, company_id, subscription_status
FROM company_users
WHERE subscription_status = 'active'
ORDER BY email;
