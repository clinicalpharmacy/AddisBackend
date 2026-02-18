import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCompaniesSchema() {
    console.log('Checking companies table schema...');
    const { data: companies, error } = await supabase.from('companies').select('*').limit(1);

    if (error) {
        console.error('Error fetching companies:', error);
    } else if (companies && companies.length > 0) {
        console.log('Companies table columns:', Object.keys(companies[0]));
    } else {
        console.log('No companies found.');
    }
}

checkCompaniesSchema();
