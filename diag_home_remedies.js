const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkHomeRemedies() {
    console.log('--- DB SCHEMA CHECK: home_remedies ---');
    try {
        const { data, error } = await supabase.from('home_remedies').select('*').limit(1);
        if (error) {
            console.error('FETCH ERROR:', error.message);
            console.error('DETAILS:', error.details);
            console.error('HINT:', error.hint);
        } else if (data && data.length > 0) {
            console.log('COLUMNS FOUND:', Object.keys(data[0]));
        } else {
            console.log('Table found but it is EMPTY.');
            // Test insert to see what fails
            const { error: insErr } = await supabase.from('home_remedies').insert([{ name: 'Test', home_remedies: 'test' }]);
            if (insErr) console.error('INSERT TEST ERROR:', insErr.message);
            else console.log('INSERT TEST: Success');
        }
    } catch (e) {
        console.error('CRASH:', e.message);
    }
    process.exit(0);
}

checkHomeRemedies();
