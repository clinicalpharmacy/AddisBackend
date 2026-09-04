/**
 * Admin Account Seeder
 * Creates or updates the two admin accounts in Supabase.
 * Run with: node create_admins.mjs
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const ADMINS = [
    {
        email: 'eskinder.cpat@gmail.com',
        password: 'Addismed@2025',
        full_name: 'Eskinder (Admin)',
        role: 'superadmin'
    },
    {
        email: 'wendebiruk02@gmail.com',
        password: 'wende3428',
        full_name: 'Wendebiruk (Admin)',
        role: 'superadmin'
    }
];

async function upsertAdmin(admin) {
    const passwordHash = await bcrypt.hash(admin.password, 10);
    const cleanEmail = admin.email.trim().toLowerCase();

    console.log(`\n🔍 Checking if ${cleanEmail} exists...`);

    // Check if user already exists
    const { data: existing, error: fetchError } = await supabase
        .from('users')
        .select('id, email, role')
        .eq('email', cleanEmail)
        .maybeSingle();

    if (fetchError) {
        console.error(`❌ Error fetching user: ${fetchError.message}`);
        return;
    }

    if (existing) {
        console.log(`✏️  User exists (id: ${existing.id}). Updating role and password...`);
        const { error: updateError } = await supabase
            .from('users')
            .update({
                role: admin.role,
                password_hash: passwordHash,
                approved: true,
                email_verified: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);

        if (updateError) {
            console.error(`❌ Update failed: ${updateError.message}`);
        } else {
            console.log(`✅ Updated ${cleanEmail} → role: ${admin.role}`);
        }
    } else {
        console.log(`➕ User not found. Creating new admin...`);
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{
                email: cleanEmail,
                full_name: admin.full_name,
                password_hash: passwordHash,
                role: admin.role,
                approved: true,
                email_verified: true,
                account_type: 'individual',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (insertError) {
            console.error(`❌ Insert failed: ${insertError.message}`);
        } else {
            console.log(`✅ Created ${cleanEmail} (id: ${newUser.id}) → role: ${admin.role}`);
        }
    }
}

async function main() {
    console.log('🚀 Admin Account Seeder Starting...\n');
    console.log(`📡 Connecting to: ${SUPABASE_URL}`);

    for (const admin of ADMINS) {
        await upsertAdmin(admin);
    }

    console.log('\n🎉 Done! Both admin accounts are ready.');
    console.log('\n📋 Summary:');
    console.log('  Admin 1: eskinder.cpat@gmail.com  (role: superadmin)');
    console.log('  Admin 2: wendebiruk02@gmail.com   (role: superadmin)');
}

main().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
