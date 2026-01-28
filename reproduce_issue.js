
import { supabase } from './src/config/supabase.js';
import bcrypt from 'bcryptjs';

async function testRegistration() {
    console.log("Starting reproduction test...");

    // Test data from user report logic
    const admin_email = "sheger@gmail.com";
    const company_name = "Sheger Pharmacy";
    const company_registration_number = "REG-SHEGER-" + Date.now();
    const admin_password = "password123";
    const admin_full_name = "Sheger Admin";
    const admin_phone = "0911223344";

    // Simulate validation
    console.log(`Validating email: ${admin_email}`);
    // skipping actual validation function call, assuming it passes as per logs

    // 1. Check existing company
    console.log("Checking existing company...");
    const { data: existingCompany, error: searchError } = await supabase.from('companies')
        .select('id')
        .or(`company_name.ilike.%${company_name}%,company_registration_number.ilike.%${company_registration_number}%`)
        .maybeSingle();

    if (searchError) {
        console.error("Search company error:", searchError);
        return;
    }

    if (existingCompany) {
        console.log("Company already exists:", existingCompany);
        // We might want to delete it to test fresh?
        // await supabase.from('companies').delete().eq('id', existingCompany.id);
    }

    // 2. Check existing admin
    console.log("Checking existing admin...");
    const { data: existingAdmin, error: adminSearchError } = await supabase.from('users')
        .select('id')
        .eq('email', admin_email)
        .maybeSingle();

    if (adminSearchError) {
        console.error("Search admin error:", adminSearchError);
        return;
    }

    if (existingAdmin) {
        console.log("Admin email already exists:", existingAdmin);
        // await supabase.from('users').delete().eq('id', existingAdmin.id);
    }

    // 3. Insert Company
    const hashedPassword = await bcrypt.hash(admin_password, 10);
    const companyData = {
        company_name: company_name,
        company_registration_number: company_registration_number,
        company_address: 'Addis Ababa',
        company_size: '1-10',
        company_type: 'pharmacy',
        tin_number: '1234567890',
        country: 'Ethiopia',
        region: 'Addis Ababa',
        user_capacity: 5,
        subscription_status: 'inactive',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    console.log("Inserting company...", companyData);
    const { data: company, error: companyError } = await supabase.from('companies').insert([companyData]).select().single();

    if (companyError) {
        console.error("Company insert error:", companyError);
        return;
    }
    console.log("Company inserted:", company.id);

    // 4. Insert Admin
    const adminData = {
        email: admin_email,
        password_hash: hashedPassword,
        full_name: admin_full_name,
        phone: admin_phone,
        company_id: company.id,
        institution: company_name,
        country: company.country,
        region: company.region,
        license_number: '',
        tin_number: '1234567890',
        approved: false,
        role: 'company_admin',
        account_type: 'company',
        subscription_status: 'inactive',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    console.log("Inserting admin...", adminData);
    const { data: adminUser, error: adminError } = await supabase.from('users').insert([adminData]).select().single();

    if (adminError) {
        console.error("Admin insert error:", adminError);
        // Rollback
        await supabase.from('companies').delete().eq('id', company.id);
        return;
    }
    console.log("Admin inserted:", adminUser.id);

    // 5. Update Company Admin
    const { error: updateError } = await supabase.from('companies').update({ admin_id: adminUser.id }).eq('id', company.id);
    if (updateError) {
        console.error("Company update error:", updateError);
    } else {
        console.log("Company updated with admin ID");
    }

    console.log("Registration successful!");
    process.exit(0);
}

testRegistration().catch(err => {
    console.error(err);
    process.exit(1);
});
