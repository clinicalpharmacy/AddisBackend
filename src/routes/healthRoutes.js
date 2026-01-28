import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { debug } from '../utils/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        debug.log('Health check requested (Optimized)');
        let dbStatus = 'not_configured';
        let userCount = 0;
        let adminExists = false;
        let pendingApprovals = 0;
        let patientsCount = 0;
        let medicationsCount = 0;

        if (supabase) {
            try {
                debug.log('Pinging database...');
                const { count: users, error: usersError } = await supabase.from('users').select('*', { count: 'exact', head: true });

                if (!usersError) {
                    dbStatus = 'connected';
                    userCount = users || 0;

                    const { count: pending } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('approved', false);
                    pendingApprovals = pending || 0;

                    const { count: patients } = await supabase.from('patients').select('*', { count: 'exact', head: true });
                    patientsCount = patients || 0;

                    const { count: medications } = await supabase.from('medications').select('*', { count: 'exact', head: true });
                    medicationsCount = medications || 0;

                    const { data: admin } = await supabase.from('users').select('id').eq('email', 'admin@pharmacare.com').maybeSingle();
                    adminExists = !!admin;
                } else {
                    dbStatus = 'error';
                }
            } catch (error) {
                dbStatus = 'error';
                debug.error('DB Health Error:', error);
            }
        }

        res.json({
            success: true,
            status: 'healthy',
            database: dbStatus,
            counts: {
                users: userCount,
                patients: patientsCount,
                medications: medicationsCount,
                pending_approvals: pendingApprovals
            },
            admin_exists: adminExists,
            server_time: new Date().toISOString(),
            uptime: process.uptime()
        });
    } catch (error) {
        res.status(500).json({ success: false, status: 'error', message: error.message });
    }
});

export default router;
