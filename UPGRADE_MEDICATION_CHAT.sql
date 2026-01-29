-- Add recipient_id to enable 1v1 private (secrete) messaging
ALTER TABLE medication_availability_comments 
ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES users(id);

-- Create index for faster querying of conversations
CREATE INDEX IF NOT EXISTS idx_med_comm_recipient ON medication_availability_comments(recipient_id);
CREATE INDEX IF NOT EXISTS idx_med_comm_post ON medication_availability_comments(post_id);

-- Migration: Set recipient_id for existing comments to the owner of the post
-- This makes all old public comments appear as private chats with the poster
UPDATE medication_availability_comments mc
SET recipient_id = ma.user_id
FROM medication_availability ma
WHERE mc.post_id = ma.id 
AND mc.recipient_id IS NULL;
