import { supabase } from './src/config/supabase.js';

async function fixCompany() {
    const companyId = '35ba5515-d5c6-4ebf-bb42-98ffe2af1c06';
    
    console.log('Creating missing company for ID:', companyId);

    const newCompany = {
        id: companyId,
        company_name: 'Test Pharmacy Co.',
        email: 'wendebiruk12@gmail.com',
        company_type: 'pharmacy'
    };

    const { data: company, error } = await supabase
        .from('companies')
        .insert([newCompany])
        .select()
        .single();

    if (error) {
        console.error('Error creating company:', error);
    } else {
        console.log('Company successfully created:', company.id);
    }
}

fixCompany();
