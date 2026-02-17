import { createClient } from '@supabase/supabase-js';

// Hardcoded for testing since check_schema.js used these
const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Testing Feedbacks Table ---');
    const { data, error } = await supabase.from('feedbacks').select('*').limit(1);

    if (error) {
        console.error('❌ Table "feedbacks" check failed:', error.message);
    } else {
        console.log('✅ Table "feedbacks" exists.');
        if (data && data.length > 0) {
            console.log('Columns:', Object.keys(data[0]));
        } else {
            console.log('Table is empty.');
            // Try inserting a test record to see if it fails
            const testData = {
                subject: 'Test Subject',
                message: 'Test Message',
                category: 'test',
                user_email: 'test@example.com',
                user_name: 'Test User',
                status: 'new',
                created_at: new Date().toISOString()
            };
            const { error: insertError } = await supabase.from('feedbacks').insert([testData]);
            if (insertError) {
                console.error('❌ Insert failed:', insertError.message);
            } else {
                console.log('✅ Insert worked!');
            }
        }
    }
}

check();
