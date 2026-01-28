-- COMPREHENSIVE FIX FOR ALL COMPANY USERS
-- This will sync ALL company users with their company's subscription
-- Run this in Supabase SQL Editor

-- Step 1: Show current state of all company users
SELECT '=== BEFORE FIX - ALL COMPANY USERS ===' as info;
SELECT 
    cu.email,
    cu.company_id,
    cu.subscription_status as user_sub_status,
    c.company_name,
    c.subscription_status as company_sub_status,
    c.subscription_plan,
    c.subscription_end_date
FROM company_users cu
LEFT JOIN companies c ON cu.company_id = c.id
ORDER BY cu.email;

-- Step 2: Show all companies and their subscription status
SELECT '=== ALL COMPANIES ===' as info;
SELECT 
    id,
    company_name,
    subscription_status,
    subscription_plan,
    subscription_end_date,
    admin_id
FROM companies
ORDER BY company_name;

-- Step 3: Update ALL company_users to match their company's subscription
UPDATE company_users cu
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE cu.company_id = c.id;

-- Step 4: Also update users table for company admins
UPDATE users u
SET 
    subscription_status = c.subscription_status,
    subscription_plan = c.subscription_plan,
    subscription_end_date = c.subscription_end_date,
    updated_at = NOW()
FROM companies c
WHERE u.company_id = c.id
AND u.role = 'company_admin';

-- Step 5: Show results after fix
SELECT '=== AFTER FIX - ALL COMPANY USERS ===' as info;
SELECT 
    cu.email,
    cu.company_id,
    cu.subscription_status as user_sub_status,
    c.company_name,
    c.subscription_status as company_sub_status,
    c.subscription_plan
FROM company_users cu
LEFT JOIN companies c ON cu.company_id = c.id
ORDER BY cu.email;

-- Step 6: Show count of active vs inactive
SELECT '=== SUMMARY ===' as info;
SELECT 
    subscription_status,
    COUNT(*) as count
FROM company_users
GROUP BY subscription_status;
