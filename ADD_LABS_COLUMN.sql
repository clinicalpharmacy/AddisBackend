
-- Add JSONB column for dynamic/custom labs to patients table
ALTER TABLE patients
ADD COLUMN IF NOT EXISTS labs JSONB DEFAULT '{}'::jsonb;
