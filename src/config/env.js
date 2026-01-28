import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: process.env.PORT || 3000,
    debug: process.env.DEBUG === 'true' || true,
    jwtSecret: process.env.JWT_SECRET || 'pharmacare-secret-key-change-in-production',
    supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    },
    chapa: {
        secretKey: process.env.CHAPA_SECRET_KEY || 'CHASECK_TEST-BUUCXuWZFwKutOudWFIBaFbwIEb51ti3',
        publicKey: process.env.CHAPA_PUBLIC_KEY || 'CHAPUBK_TEST-U7e8egufPIViBiDwS5DQJm3Fr7NBlG75',
        baseUrl: 'https://api.chapa.co/v1'
    }
};
