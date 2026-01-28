-- SIMPLE ONE-STEP FIX FOR ALL COMPANY USERS
-- Run this in Supabase SQL Editor

-- This will:
-- 1. Sync companies with their billing subscriptions
-- 2. Sync all company users with their company's subscription
-- 3. Sync company admins with their company's subscription

-- Step 1: Update companies from subscriptions table
UPDATE companies c
SET 
    subscription_status = 'active',
    subscription_plan = s.plan_id,
    subscription_end_date = s.end_date,
    updated_at = NOW()
FROM (
    SELECT DISTINCT ON (company_id)
        company_id,
        plan_id,
        end_date
    FROM subscriptions
    WHERE status = 'active'
    AND end_date > NOW()
    ORDER BY company_id, end_date DESC
) s
WHERE c.id = s.company_id;

-- Step 2: Update ALL company_users from their company
UPDATE company_users cu
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE cu.company_id = c.id;

-- Step 3: Update company admins in users table
UPDATE users u
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE u.company_id = c.id
AND u.role = 'company_admin';

-- Show results
SELECT 'FIXED COMPANIES:' as info, COUNT(*) as count
FROM companies WHERE subscription_status = 'active'
UNION ALL
SELECT 'FIXED COMPANY USERS:' as info, COUNT(*) as count
FROM company_users WHERE subscription_status = 'active'
UNION ALL
SELECT 'FIXED COMPANY ADMINS:' as info, COUNT(*) as count
FROM users WHERE role = 'company_admin' AND subscription_status = 'active';
