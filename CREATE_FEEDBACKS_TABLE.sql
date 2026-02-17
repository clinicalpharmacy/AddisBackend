-- Create feedbacks table
CREATE TABLE IF NOT EXISTS feedbacks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject TEXT,
    message TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    user_email TEXT,
    user_name TEXT,
    status TEXT DEFAULT 'new', -- e.g., 'new', 'in-progress', 'resolved', 'closed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add some basic indexes for admin performance
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedbacks(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedbacks(created_at);

-- Enable RLS (Row Level Security)
ALTER TABLE feedbacks ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public to insert feedback
CREATE POLICY "Allow public insert feedbacks" ON feedbacks
    FOR INSERT 
    TO public
    WITH CHECK (true);

-- Policy: Allow authenticated users to view their own feedback (if we tracked user_id, but here we don't yet)
-- For now, let's allow service_role/admin to see all
CREATE POLICY "Allow service_role full access" ON feedbacks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- If you have a specific admin role, you can add a policy for it
-- For example, if admins are in the 'users' table with role 'admin'
-- CREATE POLICY "Allow admin to view all feedbacks" ON feedbacks
--     FOR SELECT
--     TO authenticated
--     USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));
