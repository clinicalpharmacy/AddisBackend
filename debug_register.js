
import { supabase } from './src/config/supabase.js';
import bcrypt from 'bcryptjs';

async function reproduceRegister() {
    console.log("Starting reproduction of registration logic...");

    // Test data
    const admin_email = "sheger@gmail.com";
    const company_name = "Sheger Pharmacy";
    const company_registration_number = "REG-SHEGER-TEST-" + Date.now();
    const admin_password = "password123";
    const admin_full_name = "Sheger Admin";
    const admin_phone = "0911223344";
    const user_capacity = 5;

    // 1. Check existing companies
    const searchFilter = `company_name.ilike.%${company_name}%,company_registration_number.ilike.%${company_registration_number}%`;
    console.log("1. Checking companies with filter:", searchFilter);

    try {
        const { data: existingCompanies, error: searchError } = await supabase
            .from('companies')
            .select('id')
            .or(searchFilter)
            .limit(1);

        if (searchError) {
            console.error("❌ Company search error:", searchError);
            process.exit(1);
        }

        console.log("   Existing companies found:", existingCompanies?.length || 0);

        if (existingCompanies && existingCompanies.length > 0) {
            console.log("   ⚠️ Company exists, skipping insert logic to avoid duplicate error.");
            // process.exit(0); 
            // Continue to user check for debugging
        }
    } catch (e) {
        console.error("❌ Exception in company check:", e);
    }

    // 2. Check existing admin
    console.log("2. Checking existing admin email:", admin_email);
    try {
        const { data: existingAdmins, error: adminSearchError } = await supabase
            .from('users')
            .select('id')
            .eq('email', admin_email)
            .limit(1);

        if (adminSearchError) {
            console.error("❌ Admin search error:", adminSearchError);
            process.exit(1);
        }

        console.log("   Existing admins found:", existingAdmins?.length || 0);

        if (existingAdmins && existingAdmins.length > 0) {
            console.log("   ⚠️ Admin email taken.");
            // We expect this if test run multiple times
        }
    } catch (e) {
        console.error("❌ Exception in admin check:", e);
    }

    // 3. Insert Company
    console.log("3. Attempting Company Insert...");
    const companyData = {
        company_name: company_name + " " + Date.now(), // Ensure unique name
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

    let companyId = null;

    try {
        const { data: company, error: companyError } = await supabase.from('companies').insert([companyData]).select().single();
        if (companyError) {
            console.error("❌ Company insert error:", companyError);
            // This is where we suspect issues
            if (companyError.message) console.error("   Message:", companyError.message);
            if (companyError.details) console.error("   Details:", companyError.details);
            process.exit(1);
        }
        console.log("✅ Company inserted ID:", company.id);
        companyId = company.id;
    } catch (e) {
        console.error("❌ Exception during company insert:", e);
        process.exit(1);
    }

    // 4. Insert Admin
    console.log("4. Attempting Admin Insert...");
    const hashedPassword = await bcrypt.hash(admin_password, 10);
    const adminData = {
        email: "unique_" + Date.now() + "_" + admin_email, // Ensure unique email
        password_hash: hashedPassword,
        full_name: admin_full_name,
        phone: admin_phone,
        company_id: companyId,
        institution: company_name,
        country: 'Ethiopia',
        region: 'Addis Ababa',
        license_number: '',
        tin_number: '1234567890',
        approved: false,
        role: 'company_admin',
        account_type: 'company',
        subscription_status: 'inactive',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    try {
        const { data: adminUser, error: adminError } = await supabase.from('users').insert([adminData]).select().single();
        if (adminError) {
            console.error("❌ Admin insert error:", adminError);
            if (adminError.message) console.error("   Message:", adminError.message);

            // cleanup
            console.log("   Rolling back company...");
            await supabase.from('companies').delete().eq('id', companyId);
            process.exit(1);
        }
        console.log("✅ Admin inserted ID:", adminUser.id);

        // 5. Update Company
        console.log("5. Updating company with admin ID...");
        const { error: updateError } = await supabase.from('companies').update({ admin_id: adminUser.id }).eq('id', companyId);
        if (updateError) {
            console.error("❌ Company update error:", updateError);
        } else {
            console.log("✅ Registration Complete!");
        }

    } catch (e) {
        console.error("❌ Exception during admin insert:", e);
        // cleanup
        await supabase.from('companies').delete().eq('id', companyId);
    }

    process.exit(0);
}

reproduceRegister().catch(e => {
    console.error(e);
    process.exit(1);
});
