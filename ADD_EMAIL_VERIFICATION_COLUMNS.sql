-- Add email verification columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_verification_token TEXT,
ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP WITH TIME ZONE;

-- Add email verification columns to company_users table
ALTER TABLE company_users 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS email_verification_token TEXT,
ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP WITH TIME ZONE;

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);
CREATE INDEX IF NOT EXISTS idx_company_users_email_verification_token ON company_users(email_verification_token);

-- Update existing users to have email_verified = true (for backward compatibility)
-- Comment out if you want existing users to verify their emails
-- UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL;
-- UPDATE company_users SET email_verified = TRUE WHERE email_verified IS NULL;
