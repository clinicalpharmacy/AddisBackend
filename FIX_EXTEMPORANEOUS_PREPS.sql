-- MASTER FIX FOR KNOWLEDGE BASE TABLES
-- This script fixes extemporaneous_preparations, home_remedies, minor_illnesses, and medication_information.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-----------------------------------------------------------
-- 1. EXTEMPORANEOUS PREPARATIONS
-----------------------------------------------------------
CREATE TABLE IF NOT EXISTS extemporaneous_preparations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    formula_name TEXT,
    materials TEXT,
    preparation_steps TEXT,
    label_instructions TEXT,
    storage_info TEXT,
    stability_info TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safely add columns
ALTER TABLE extemporaneous_preparations ADD COLUMN IF NOT EXISTS formula_name TEXT;
ALTER TABLE extemporaneous_preparations ADD COLUMN IF NOT EXISTS materials TEXT;
ALTER TABLE extemporaneous_preparations ADD COLUMN IF NOT EXISTS preparation_steps TEXT;
ALTER TABLE extemporaneous_preparations ADD COLUMN IF NOT EXISTS label_instructions TEXT;
ALTER TABLE extemporaneous_preparations ADD COLUMN IF NOT EXISTS storage_info TEXT;
ALTER TABLE extemporaneous_preparations ADD COLUMN IF NOT EXISTS stability_info TEXT;

-- Remove NOT NULL from OLD columns to prevent insertion errors
ALTER TABLE extemporaneous_preparations ALTER COLUMN "name" DROP NOT NULL;
ALTER TABLE extemporaneous_preparations ALTER COLUMN "ingredients" DROP NOT NULL;
ALTER TABLE extemporaneous_preparations ALTER COLUMN "instructions" DROP NOT NULL;
ALTER TABLE extemporaneous_preparations ALTER COLUMN "preparation" DROP NOT NULL;

-- Migrate data to new columns if null
UPDATE extemporaneous_preparations SET formula_name = name WHERE formula_name IS NULL AND name IS NOT NULL;
UPDATE extemporaneous_preparations SET materials = ingredients WHERE materials IS NULL AND ingredients IS NOT NULL;
UPDATE extemporaneous_preparations SET preparation_steps = COALESCE(instructions, preparation) WHERE preparation_steps IS NULL AND (instructions IS NOT NULL OR preparation IS NOT NULL);

-- Set defaults for new mandatory columns
UPDATE extemporaneous_preparations SET formula_name = 'Unnamed Formula' WHERE formula_name IS NULL;
UPDATE extemporaneous_preparations SET materials = 'Materials not specified' WHERE materials IS NULL;
UPDATE extemporaneous_preparations SET preparation_steps = 'Preparation steps not specified' WHERE preparation_steps IS NULL;

-- Apply NOT NULL to new columns
ALTER TABLE extemporaneous_preparations ALTER COLUMN formula_name SET NOT NULL;
ALTER TABLE extemporaneous_preparations ALTER COLUMN materials SET NOT NULL;
ALTER TABLE extemporaneous_preparations ALTER COLUMN preparation_steps SET NOT NULL;

-----------------------------------------------------------
-- 2. HOME REMEDIES
-----------------------------------------------------------
CREATE TABLE IF NOT EXISTS home_remedies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    amharic_name TEXT,
    home_remedies TEXT NOT NULL,
    medical_advise TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS amharic_name TEXT;
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS home_remedies TEXT;
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS medical_advise TEXT;

-- Set defaults and constraints
UPDATE home_remedies SET name = 'Unnamed Remedy' WHERE name IS NULL;
UPDATE home_remedies SET home_remedies = 'Description pending' WHERE home_remedies IS NULL;
ALTER TABLE home_remedies ALTER COLUMN name SET NOT NULL;
ALTER TABLE home_remedies ALTER COLUMN home_remedies SET NOT NULL;

-----------------------------------------------------------
-- 3. MINOR ILLNESSES
-----------------------------------------------------------
CREATE TABLE IF NOT EXISTS minor_illnesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    amharic_name TEXT,
    assessment TEXT NOT NULL,
    referral TEXT,
    otc_drug TEXT,
    for_pharmacists TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------------------------------
-- 4. MEDICATION INFORMATION
-----------------------------------------------------------
CREATE TABLE IF NOT EXISTS medication_information (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    amharic_name TEXT,
    usage TEXT NOT NULL,
    administration_and_cautions TEXT,
    side_effects TEXT,
    storage TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-----------------------------------------------------------
-- 5. PERMISSIONS & RLS (Unified Policy)
-----------------------------------------------------------
DO $$ 
DECLARE 
    t TEXT;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' 
    AND table_name IN ('extemporaneous_preparations', 'home_remedies', 'minor_illnesses', 'medication_information') LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow public full access" ON %I', t);
        EXECUTE format('CREATE POLICY "Allow public full access" ON %I FOR ALL TO public USING (true) WITH CHECK (true)', t);
    END LOOP;
END $$;

-- Force Schema Refresh
NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE extemporaneous_preparations IS 'Store compounding formulas and extemporaneous preparations.';
COMMENT ON TABLE home_remedies IS 'Traditional home remedies and medical advice.';
COMMENT ON TABLE minor_illnesses IS 'Guide for managing common minor illnesses.';
COMMENT ON TABLE medication_information IS 'Detailed information about medications.';
