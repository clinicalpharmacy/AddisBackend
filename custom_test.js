import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPatient() {
    console.log('Querying id = 158...');
    const { data: q1, error: e1 } = await supabase.from('patients').select('id, patient_code').eq('id', '158').maybeSingle();
    console.log('q1:', q1, 'e1:', e1?.message);
    
    console.log('Querying patient_code = 158...');
    const { data: q2, error: e2 } = await supabase.from('patients').select('id, patient_code').eq('patient_code', '158').maybeSingle();
    console.log('q2:', q2, 'e2:', e2?.message);
}
checkPatient();
