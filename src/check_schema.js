import { supabase } from './config/supabase.js';

async function checkTableColumns(tableName) {
    console.log(`\n--- Checking ${tableName} ---`);
    try {
        const { data, error } = await supabase.from(tableName).select('*').limit(1);
        if (error) {
            console.error(`Error fetching ${tableName}:`, error.message);
            const { error: err1 } = await supabase.from(tableName).select('user_id').limit(1);
            console.log('user_id exists:', !err1);
            const { error: err2 } = await supabase.from(tableName).select('created_by').limit(1);
            console.log('created_by exists:', !err2);
        } else if (data && data.length > 0) {
            console.log(`Columns in ${tableName}:`, Object.keys(data[0]));
        } else {
            console.log(`No data in ${tableName}.`);
            const { error: err1 } = await supabase.from(tableName).select('user_id').limit(1);
            console.log('user_id exists:', !err1);
            const { error: err2 } = await supabase.from(tableName).select('created_by').limit(1);
            console.log('created_by exists:', !err2);
        }
    } catch (e) {
        console.error(`Unexpected error for ${tableName}:`, e);
    }
}

async function run() {
    await checkTableColumns('medication_history');
    await checkTableColumns('vitals_history');
    await checkTableColumns('labs_history');
}

run();
