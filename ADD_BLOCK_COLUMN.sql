-- Add is_blocked column to users and company_users tables
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
