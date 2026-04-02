import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTable() {
    const { data, error } = await supabase.rpc('inspect_table_columns', { table_name_input: 'patients' });
    
    if (error) {
        // Fallback to direct query if RPC doesn't exist
        console.log('RPC failed, trying information_schema...');
        const { data: schema, error: schemaError } = await supabase
            .from('patients')
            .select('*')
            .limit(1);
            
        if (schemaError) {
          console.error(schemaError);
          return;
        }
        
        console.log('Sample Data Key types:');
        if (schema[0]) {
          Object.keys(schema[0]).forEach(k => {
            console.log(`${k}: ${typeof schema[0][k]}`);
          });
        }
    } else {
        console.log('Table Schema:', data);
    }
}

inspectTable();
