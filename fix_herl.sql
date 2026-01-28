-- Manual fix for herl@gmail.com subscription issue
-- Run this to sync the user with their company's subscription

-- First, let's see what we have
SELECT 'User Record:' as info;
SELECT id, email, company_id, subscription_status, subscription_end_date 
FROM users 
WHERE email = 'herl@gmail.com';

SELECT 'Company User Record:' as info;
SELECT id, email, company_id, subscription_status, subscription_end_date 
FROM company_users 
WHERE email = 'herl@gmail.com';

-- Find the company
SELECT 'Company Record:' as info;
SELECT c.id, c.company_name, c.subscription_status, c.subscription_plan, c.subscription_end_date
FROM companies c
WHERE c.id IN (
    SELECT company_id FROM users WHERE email = 'herl@gmail.com'
    UNION
    SELECT company_id FROM company_users WHERE email = 'herl@gmail.com'
);

-- Find active subscriptions for this company
SELECT 'Active Subscriptions:' as info;
SELECT s.*
FROM subscriptions s
WHERE s.company_id IN (
    SELECT company_id FROM users WHERE email = 'herl@gmail.com'
    UNION
    SELECT company_id FROM company_users WHERE email = 'herl@gmail.com'
)
AND s.status = 'active'
AND s.end_date > NOW()
ORDER BY s.created_at DESC;

-- Now let's fix it - Update user record to match company subscription
UPDATE users u
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE u.email = 'herl@gmail.com'
AND u.company_id = c.id
AND c.subscription_status = 'active';

-- Verify the fix
SELECT 'After Fix - User Record:' as info;
SELECT id, email, company_id, subscription_status, subscription_plan, subscription_end_date 
FROM users 
WHERE email = 'herl@gmail.com';
