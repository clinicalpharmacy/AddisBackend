import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('Testing access_requests join...');
    const { data: testData, error: testError } = await supabase.from('access_requests')
        .select(`
            *,
            owner:owner_id(*)
        `)
        .limit(1);

    if (testError) {
        console.error('❌ JOIN FAILED!', testError.message);
        console.log('Checking columns of access_requests instead...');
        const { data: cols, error: colError } = await supabase.from('access_requests').select('*').limit(1);
        if (cols && cols.length > 0) {
            console.log('Columns:', Object.keys(cols[0]));
        } else {
            console.log('Table found but empty.');
        }
    } else {
        console.log('✅ JOIN SUCCESS!', testData);
    }
}

inspect();
