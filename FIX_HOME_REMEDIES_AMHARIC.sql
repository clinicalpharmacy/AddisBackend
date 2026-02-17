-- ULTIMATE FIX for home_remedies column naming conflicts
-- This script handles "home_remedy" vs "home_remedies" and "uses" conflicts.

-- 1. Remove NOT NULL from all known old/conflicting columns
-- This prevents the "23502" error for "home_remedy", "uses", etc.
ALTER TABLE home_remedies ALTER COLUMN "home_remedy" DROP NOT NULL;
ALTER TABLE home_remedies ALTER COLUMN "uses" DROP NOT NULL;
ALTER TABLE home_remedies ALTER COLUMN "name" DROP NOT NULL;

-- 2. Ensure the columns used by the current app code exist
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS amharic_name TEXT;
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS home_remedies TEXT;
ALTER TABLE home_remedies ADD COLUMN IF NOT EXISTS medical_advise TEXT;

-- 3. Sync data from old singular names to new plural names if needed
-- This preserves your existing data
UPDATE home_remedies SET home_remedies = home_remedy WHERE home_remedies IS NULL AND home_remedy IS NOT NULL;
UPDATE home_remedies SET home_remedies = uses WHERE home_remedies IS NULL AND uses IS NOT NULL;

-- 4. Apply NOT NULL ONLY to what the current app definitely sends
-- We check for nulls first to avoid errors
UPDATE home_remedies SET name = 'Unnamed' WHERE name IS NULL;
UPDATE home_remedies SET home_remedies = 'Description pending' WHERE home_remedies IS NULL;

ALTER TABLE home_remedies ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE home_remedies ALTER COLUMN "home_remedies" SET NOT NULL;

-- 5. Final Permission & Cache Refresh
ALTER TABLE home_remedies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public full access" ON home_remedies;
CREATE POLICY "Allow public full access" ON home_remedies FOR ALL TO public USING (true) WITH CHECK (true);

-- Force Supabase to rebuild the schema cache
NOTIFY pgrst, 'reload schema';
