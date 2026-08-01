import { config } from 'dotenv';
config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testInsert() {
    console.log('Attempting to insert test subject...');
    const { data, error } = await supabase
        .from('exam_subjects')
        .insert({ name: 'Test Subject ' + Date.now() })
        .select();
    
    if (error) {
        console.error('INSERT ERROR:', error);
    } else {
        console.log('INSERT SUCCESS:', data);
    }
}

testInsert();
