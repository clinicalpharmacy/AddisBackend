-- Add lactation columns to patients table
ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_lactating BOOLEAN DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS lactation_notes TEXT;

-- Update existing records to have FALSE instead of NULL for the boolean column
UPDATE patients SET is_lactating = FALSE WHERE is_lactating IS NULL;

-- Verify columns
COMMENT ON COLUMN patients.is_lactating IS 'Whether the patient is currently breastfeeding/lactating';
COMMENT ON COLUMN patients.lactation_notes IS 'Additional clinical notes regarding lactation status';
