import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTypes() {
    // We can't query information_schema directly via Supabase client usually unless enabled
    // But we can try a raw SQL query if we have an RPC
    const { data, error } = await supabase.from('patients').select('*').limit(1);
    
    if (error) {
        console.error(error);
        return;
    }
    
    console.log('Sample Data Key types:');
    if (data[0]) {
      Object.entries(data[0]).forEach(([k, v]) => {
        console.log(`${k}: ${v === null ? 'null' : typeof v}`);
      });
    }
}

inspectTypes();
