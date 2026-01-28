-- FORCE FIX FOR HERL@GMAIL.COM
-- This will activate herl's subscription directly
-- Run this in Supabase SQL Editor

-- First, let's see what we have
SELECT 'CURRENT STATE:' as info;
SELECT 'users table' as location, id, email, company_id, subscription_status 
FROM users WHERE email = 'herl@gmail.com'
UNION ALL
SELECT 'company_users table' as location, id, email, company_id, subscription_status 
FROM company_users WHERE email = 'herl@gmail.com';

-- Option 1: If herl is in the users table, activate her directly
UPDATE users
SET 
    subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_end_date = (NOW() + INTERVAL '1 year')::timestamp,
    updated_at = NOW()
WHERE email = 'herl@gmail.com';

-- Option 2: If herl is in company_users table, activate her directly
UPDATE company_users
SET 
    subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_end_date = (NOW() + INTERVAL '1 year')::timestamp,
    updated_at = NOW()
WHERE email = 'herl@gmail.com';

-- Verify the fix
SELECT 'AFTER FIX:' as info;
SELECT 'users table' as location, id, email, company_id, subscription_status, subscription_plan, subscription_end_date
FROM users WHERE email = 'herl@gmail.com'
UNION ALL
SELECT 'company_users table' as location, id, email, company_id, subscription_status, subscription_plan, subscription_end_date
FROM company_users WHERE email = 'herl@gmail.com';
