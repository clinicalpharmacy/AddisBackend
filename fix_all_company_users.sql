-- Fix all existing company_users to inherit their company's subscription
-- This updates users who were created before the automatic inheritance was added

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

-- Show results
SELECT 
    'Fixed Company Users:' as info,
    COUNT(*) as count
FROM company_users cu
JOIN companies c ON cu.company_id = c.id
WHERE c.subscription_status = 'active'
AND cu.subscription_status = 'active';
