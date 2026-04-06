import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('Inspecting access_requests...');
    const { data, error } = await supabase.from('access_requests').select('*').limit(1);
    if (error) {
        console.error('Error fetching access_requests!', error);
    } else if (data && data.length > 0) {
        console.log('Columns in access_requests:', Object.keys(data[0]));
    } else {
        console.log('Table exists but is empty.');
        // Try to get keys via RPC if empty
    }
}

inspect();
