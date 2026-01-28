-- Check herl@gmail.com current status
SELECT 'HERL USER RECORD:' as section;
SELECT id, email, company_id, subscription_status, subscription_plan, subscription_end_date
FROM users WHERE email = 'herl@gmail.com';

SELECT 'HERL COMPANY_USER RECORD:' as section;
SELECT id, email, company_id, subscription_status, subscription_plan, subscription_end_date
FROM company_users WHERE email = 'herl@gmail.com';

-- Check the company
SELECT 'COMPANY RECORD:' as section;
SELECT c.id, c.company_name, c.subscription_status, c.subscription_plan, c.subscription_end_date
FROM companies c
WHERE c.id IN (
    SELECT company_id FROM users WHERE email = 'herl@gmail.com' AND company_id IS NOT NULL
    UNION
    SELECT company_id FROM company_users WHERE email = 'herl@gmail.com' AND company_id IS NOT NULL
);

-- Check all active companies
SELECT 'ALL ACTIVE COMPANIES:' as section;
SELECT id, company_name, subscription_status, subscription_plan, subscription_end_date
FROM companies
WHERE subscription_status = 'active';

-- Check all company users
SELECT 'ALL COMPANY USERS:' as section;
SELECT email, company_id, subscription_status
FROM company_users
ORDER BY created_at DESC
LIMIT 10;
