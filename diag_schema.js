const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchemaDetail() {
    console.log('--- DB SCHEMA CHECK ---');
    try {
        const { data: preps, error } = await supabase.from('extemporaneous_preparations').select('*').limit(1);
        if (error) {
            console.error('FETCH ERROR:', error.message);
            console.error('FULL ERROR:', JSON.stringify(error, null, 2));
        } else if (preps && preps.length > 0) {
            console.log('COLUMNS FOUND:', Object.keys(preps[0]));
        } else {
            console.log('Table found but it is EMPTY.');
            // Try to add a test row to see what fails
            const { error: insertError } = await supabase.from('extemporaneous_preparations').insert([{ formula_name: 'test' }]);
            console.log('INSERT TEST:', insertError ? insertError.message : 'Success');
        }
    } catch (e) {
        console.error('CRASH:', e.message);
    }
    process.exit(0);
}

checkSchemaDetail();
