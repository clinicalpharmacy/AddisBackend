import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixExistingUsers() {
    console.log('🔄 Approving all existing individual users...');

    // We want to approve anyone who is NOT a company_admin and NOT approved
    // This includes pharmacists, doctors, nurses, students, etc.
    const { data: users, error } = await supabase
        .from('users')
        .update({ approved: true })
        .not('role', 'eq', 'company_admin')
        .not('role', 'eq', 'admin')
        .not('role', 'eq', 'superadmin')
        .eq('approved', false)
        .select('email');

    if (error) {
        console.error('❌ Error updating users:', error.message);
    } else {
        console.log(`✅ Successfully approved ${users?.length || 0} existing individual users.`);
        if (users && users.length > 0) {
            console.log('Sample users approved:', users.slice(0, 5).map(u => u.email).join(', '));
        }
    }
}

fixExistingUsers();
