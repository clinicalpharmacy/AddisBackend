-- Add password reset columns to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS reset_password_token TEXT,
ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;

-- Add password reset columns to company_users table
ALTER TABLE company_users 
ADD COLUMN IF NOT EXISTS reset_password_token TEXT,
ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_password_token);
CREATE INDEX IF NOT EXISTS idx_company_users_reset_token ON company_users(reset_password_token);

-- Add comment for documentation
COMMENT ON COLUMN users.reset_password_token IS 'Temporary token for password reset, expires after 1 hour';
COMMENT ON COLUMN users.reset_password_expires IS 'Expiration timestamp for reset token';
COMMENT ON COLUMN company_users.reset_password_token IS 'Temporary token for password reset, expires after 1 hour';
COMMENT ON COLUMN company_users.reset_password_expires IS 'Expiration timestamp for reset token';
