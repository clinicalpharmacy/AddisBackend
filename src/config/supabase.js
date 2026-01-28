import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';
import { debug } from '../utils/logger.js';

let supabase;
let supabaseAdmin;

try {
    if (config.supabase.url && config.supabase.anonKey) {
        supabase = createClient(config.supabase.url, config.supabase.anonKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            },
            global: {
                headers: {
                    'apikey': config.supabase.anonKey
                }
            }
        });
        debug.success('Supabase connected');

        if (config.supabase.serviceRoleKey) {
            supabaseAdmin = createClient(
                config.supabase.url,
                config.supabase.serviceRoleKey,
                {
                    auth: {
                        autoRefreshToken: false,
                        persistSession: false
                    },
                    global: {
                        headers: {
                            'apikey': config.supabase.serviceRoleKey,
                            'Authorization': `Bearer ${config.supabase.serviceRoleKey}`
                        }
                    }
                }
            );
            debug.success('Supabase Admin client created');
        }
    } else {
        debug.warn('Supabase not configured. Check environment variables.');
        debug.warn(`SUPABASE_URL: ${config.supabase.url ? 'SET' : 'NOT SET'}`);
        debug.warn(`SUPABASE_ANON_KEY: ${config.supabase.anonKey ? 'SET' : 'NOT SET'}`);
    }
} catch (error) {
    debug.error('Supabase initialization error:', error);
}

export { supabase, supabaseAdmin };
