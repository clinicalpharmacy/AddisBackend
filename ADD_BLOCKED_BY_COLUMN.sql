-- Add blocked_by column to track who performed the block action
-- This allows us to prevent company admins from unblocking users blocked by superadmins

ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by text;
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS blocked_by text;

-- Update existing blocked users to 'superadmin' by default as a safe fallback
UPDATE users SET blocked_by = 'superadmin' WHERE is_blocked = true AND blocked_by IS NULL;
UPDATE company_users SET blocked_by = 'superadmin' WHERE is_blocked = true AND blocked_by IS NULL;
