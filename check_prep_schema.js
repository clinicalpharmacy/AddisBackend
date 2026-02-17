import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPrepSchema() {
    console.log('Checking extemporaneous_preparations table schema...');
    const { data: preps, error } = await supabase.from('extemporaneous_preparations').select('*').limit(1);

    if (error) {
        console.error('Error fetching preparations:', error);
    } else if (preps && preps.length > 0) {
        console.log('Table columns:', Object.keys(preps[0]));
    } else {
        console.log('No preparations found to check schema. Trying rpc...');
        const { data: cols, error: colError } = await supabase.rpc('get_column_names', { table_name: 'extemporaneous_preparations' });
        if (colError) console.error('Column fetch error:', colError);
        else console.log('Columns:', cols);
    }
}

checkPrepSchema();
