-- CHECK AND FIX COMPANY SUBSCRIPTIONS
-- This checks if companies have paid subscriptions but aren't marked as active

-- Step 1: Show all companies
SELECT '=== ALL COMPANIES ===' as info;
SELECT 
    id,
    company_name,
    subscription_status,
    subscription_plan,
    subscription_end_date,
    created_at
FROM companies
ORDER BY created_at DESC;

-- Step 2: Check subscriptions table for active payments
SELECT '=== ACTIVE SUBSCRIPTIONS IN BILLING ===' as info;
SELECT 
    s.id,
    s.company_id,
    c.company_name,
    s.plan_name,
    s.status,
    s.end_date,
    s.created_at
FROM subscriptions s
LEFT JOIN companies c ON s.company_id = c.id
WHERE s.status = 'active'
AND s.end_date > NOW()
ORDER BY s.created_at DESC;

-- Step 3: Find companies with active subscriptions in billing but marked inactive
SELECT '=== COMPANIES THAT SHOULD BE ACTIVE ===' as info;
SELECT DISTINCT
    c.id,
    c.company_name,
    c.subscription_status as current_status,
    s.plan_name,
    s.end_date
FROM companies c
INNER JOIN subscriptions s ON c.id = s.company_id
WHERE s.status = 'active'
AND s.end_date > NOW()
AND (c.subscription_status IS NULL OR c.subscription_status != 'active');

-- Step 4: FIX - Update companies based on their active subscriptions
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
WHERE c.id = s.company_id
AND (c.subscription_status IS NULL OR c.subscription_status != 'active');

-- Step 5: Verify companies are now active
SELECT '=== AFTER FIX - ACTIVE COMPANIES ===' as info;
SELECT 
    id,
    company_name,
    subscription_status,
    subscription_plan,
    subscription_end_date
FROM companies
WHERE subscription_status = 'active'
ORDER BY company_name;
