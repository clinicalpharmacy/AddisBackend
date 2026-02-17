import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPatientSchema() {
    console.log('Checking patients table schema...');
    const { data: patients, error } = await supabase.from('patients').select('*').limit(1);

    if (error) {
        console.error('Error fetching patients:', error);
    } else if (patients && patients.length > 0) {
        console.log('Patients table columns:', Object.keys(patients[0]));
        console.log('Has is_lactating?', 'is_lactating' in patients[0]);
    } else {
        console.log('No patients found to check schema.');
    }
}

checkPatientSchema();
