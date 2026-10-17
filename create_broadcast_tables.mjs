/**
 * Create broadcast tables in Supabase
 * Run: node create_broadcast_tables.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTables() {
    console.log('🔧 Creating broadcast notification tables...\n');

    // Test if broadcasts table already exists by trying to select from it
    const { data: existingBroadcasts, error: checkErr } = await supabase
        .from('broadcasts')
        .select('id')
        .limit(1);

    if (!checkErr) {
        console.log('✅ broadcasts table already exists');
    } else if (checkErr.message.includes('does not exist') || checkErr.code === '42P01') {
        console.log('⚠️  broadcasts table does not exist.');
        console.log('   Please run the following SQL in your Supabase SQL Editor:\n');
        console.log(`
CREATE TABLE IF NOT EXISTS broadcasts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broadcast_reads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, broadcast_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_reads_user ON broadcast_reads(user_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_reads_broadcast ON broadcast_reads(broadcast_id);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read broadcasts" ON broadcasts FOR SELECT USING (true);
CREATE POLICY "Allow all insert broadcasts" ON broadcasts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all delete broadcasts" ON broadcasts FOR DELETE USING (true);
CREATE POLICY "Allow all read broadcast_reads" ON broadcast_reads FOR SELECT USING (true);
CREATE POLICY "Allow all insert broadcast_reads" ON broadcast_reads FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all upsert broadcast_reads" ON broadcast_reads FOR UPDATE USING (true) WITH CHECK (true);
        `);
    } else {
        console.log('⚠️  Check error:', checkErr.message);
    }

    // Test broadcast_reads
    const { error: checkReadsErr } = await supabase
        .from('broadcast_reads')
        .select('id')
        .limit(1);

    if (!checkReadsErr) {
        console.log('✅ broadcast_reads table already exists');
    } else if (checkReadsErr.message.includes('does not exist') || checkReadsErr.code === '42P01') {
        console.log('⚠️  broadcast_reads table does not exist. See SQL above.');
    }

    // Try inserting a test broadcast if tables exist
    if (!checkErr && !checkReadsErr) {
        console.log('\n🧪 Testing insert...');
        const { data, error } = await supabase
            .from('broadcasts')
            .insert({
                title: '🎉 Welcome to Broadcast Notifications!',
                message: 'This is your first test broadcast. Admin can send important updates to all users from the Broadcasts tab.',
                priority: 'normal',
                created_by_name: 'System'
            })
            .select()
            .single();

        if (error) {
            console.log('❌ Insert test failed:', error.message);
        } else {
            console.log('✅ Test broadcast created:', data.id);
        }
    }

    console.log('\n✨ Done!');
}

createTables().catch(console.error);
