-- FIX FOR ORPHANED MEDICATION POSTS
-- This script fixes posts that have no owner (user_id is NULL)

-- 1. Identify orphaned posts (you can see these in the logs)
-- SELECT * FROM medication_availability WHERE user_id IS NULL;

-- 2. Option A: Delete orphaned posts that can't be messaged anyway
DELETE FROM medication_availability_comments WHERE post_id IN (SELECT id FROM medication_availability WHERE user_id IS NULL);
DELETE FROM medication_availability WHERE user_id IS NULL;

-- 3. Option B: (If you prefer not to delete) Assign orphaned posts to an admin user
-- Replace 'ADMIN_UUID_HERE' with a real user id from your users table
-- UPDATE medication_availability SET user_id = 'ADMIN_UUID_HERE' WHERE user_id IS NULL;

-- 4. CRITICAL: Prevent this from happening again by adding a NOT NULL constraint
-- First, ensure all existing nulls are gone (using Option A or B above)
ALTER TABLE medication_availability ALTER COLUMN user_id SET NOT NULL;

-- 5. Fix any comments that might still have NULL recipient_id because they were linked to orphaned posts
UPDATE medication_availability_comments mc
SET recipient_id = ma.user_id
FROM medication_availability ma
WHERE mc.post_id = ma.id 
AND mc.recipient_id IS NULL;
