
-- Remove company_registration_number
ALTER TABLE companies 
DROP COLUMN IF EXISTS company_registration_number;

-- Add generic company email
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Add admin_email to companies table for easier access/visibility
ALTER TABLE companies
ADD COLUMN IF NOT EXISTS admin_email VARCHAR(255);
