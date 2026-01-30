import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.Yw1_LjXvbvjQFKxMKgzPaHJBOWdRqNzfmhQUGgMXvqI';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log('Checking users table schema...');
    const { data: users, error: usersError } = await supabase.from('users').select('*').limit(1);

    if (usersError) {
        console.error('Error fetching users:', usersError);
    } else if (users && users.length > 0) {
        console.log('Users table columns:', Object.keys(users[0]));
        console.log('Has reset_password_token?', 'reset_password_token' in users[0]);
        console.log('Has reset_password_expires?', 'reset_password_expires' in users[0]);
    }

    console.log('\nChecking company_users table schema...');
    const { data: companyUsers, error: companyError } = await supabase.from('company_users').select('*').limit(1);

    if (companyError) {
        console.error('Error fetching company_users:', companyError);
    } else if (companyUsers && companyUsers.length > 0) {
        console.log('Company_users table columns:', Object.keys(companyUsers[0]));
        console.log('Has reset_password_token?', 'reset_password_token' in companyUsers[0]);
        console.log('Has reset_password_expires?', 'reset_password_expires' in companyUsers[0]);
    }
}

checkSchema();
