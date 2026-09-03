import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: process.env.PORT || 3000,
    debug: process.env.DEBUG === 'true' || true,
    jwtSecret: process.env.JWT_SECRET || 'pharmacare-secret-key-change-in-production',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    },
    chapa: {
        secretKey: process.env.CHAPA_SECRET_KEY || 'CHASECK-A0g5zIc1rOzNMwjLWvP7zmOOQZJ5vaMT',
        publicKey: process.env.CHAPA_PUBLIC_KEY || 'CHAPUBK-dQ9pLbc7gpgRpm5elwp2i7wdymd4KcKa',
        baseUrl: 'https://api.chapa.co/v1'
    },
    email: {
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD
    },
    emailHost: process.env.EMAIL_HOST || 'smtp.gmail.com',
    emailPort: process.env.EMAIL_PORT || 587,
    emailUser: process.env.EMAIL_USER,
    emailPassword: process.env.EMAIL_PASSWORD
};
