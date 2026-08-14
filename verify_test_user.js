import { supabase } from './src/config/supabase.js';

async function verifyUser() {
    const email = 'wendebiruk12@gmail.com';
    console.log(`Verifying user ${email}...`);
    
    const { data, error } = await supabase
        .from('users')
        .update({ email_verified: true })
        .eq('email', email)
        .select();
        
    if (error) {
        console.error('Error verifying user:', error);
    } else {
        console.log('Success! User is now verified:', data);
    }
}

verifyUser();
