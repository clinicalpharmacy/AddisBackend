-- FIX EBS COMPANY AND ALL ITS USERS
-- This will activate the EBS company and all its employees

-- Step 1: Activate EBS company
UPDATE companies
SET 
    subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_end_date = (NOW() + INTERVAL '1 year')::timestamp,
    updated_at = NOW()
WHERE company_name = 'ebs' 
OR id = 'b95fec02-2064-43b9-9207-c1aa05d09480';

-- Step 2: Update ALL users in EBS company (company_users table)
UPDATE company_users
SET 
    subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_end_date = (NOW() + INTERVAL '1 year')::timestamp,
    updated_at = NOW()
WHERE company_id = 'b95fec02-2064-43b9-9207-c1aa05d09480';

-- Step 3: Update company admin in users table
UPDATE users
SET 
    subscription_status = 'active',
    subscription_plan = 'premium',
    subscription_end_date = (NOW() + INTERVAL '1 year')::timestamp,
    updated_at = NOW()
WHERE company_id = 'b95fec02-2064-43b9-9207-c1aa05d09480';

-- Step 4: Verify the fix
SELECT '=== EBS COMPANY STATUS ===' as info;
SELECT 
    company_name,
    subscription_status,
    subscription_plan,
    subscription_end_date
FROM companies
WHERE id = 'b95fec02-2064-43b9-9207-c1aa05d09480';

SELECT '=== ALL EBS EMPLOYEES ===' as info;
SELECT 
    email,
    subscription_status,
    subscription_plan,
    account_type
FROM company_users
WHERE company_id = 'b95fec02-2064-43b9-9207-c1aa05d09480'
ORDER BY email;

SELECT '=== EBS ADMIN ===' as info;
SELECT 
    email,
    subscription_status,
    subscription_plan,
    role
FROM users
WHERE company_id = 'b95fec02-2064-43b9-9207-c1aa05d09480';
