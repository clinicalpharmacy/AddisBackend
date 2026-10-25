import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { config } from '../config/env.js';
import { sendTestNotification, sendPushToUser } from '../services/reminderService.js';

const router = express.Router();
const db = supabaseAdmin || supabase;

/**
 * ------------------------------------------------------------------
 * PRIVACY MODEL
 * ------------------------------------------------------------------
 * The medication_schedules.medication_name column is REPURPOSED to
 * store a short label (A, B, C, ..., Z, AA, AB, ...) — NOT the real
 * medication name. Real names are kept in the browser's localStorage
 * and never reach this server.
 *
 * If you prefer a cleaner schema, run:
 *   ALTER TABLE medication_schedules ADD COLUMN label TEXT;
 *   ALTER TABLE medication_schedules ALTER COLUMN medication_name DROP NOT NULL;
 * then switch the code below to use `label` instead of `medication_name`.
 * ------------------------------------------------------------------
 */

const LABEL_RE = /^[A-Z]{1,3}$/;

const toScheduleResponse = (row) => {
    const { medication_name, ...rest } = row;
    return { ...rest, label: medication_name ?? null };
};

router.get('/vapid-public-key', (req, res) => {
    res.json({ success: true, publicKey: config.vapid?.publicKey || '' });
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const todayStr = new Date().toISOString().split('T')[0];

        const { data: schedules, error: schedErr } = await db
            .from('medication_schedules')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (schedErr) throw schedErr;

        const { data: todayLogs, error: logErr } = await db
            .from('medication_reminder_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('scheduled_date', todayStr);
        if (logErr) throw logErr;

        const { count: subscriptionCount } = await db
            .from('push_subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        res.json({
            success: true,
            schedules: (schedules || []).map(toScheduleResponse),
            todayLogs: todayLogs || [],
            hasActiveDevices: (subscriptionCount || 0) > 0,
            deviceCount: subscriptionCount || 0
        });
    } catch (err) {
        console.error('Error fetching reminders:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        // NOTE: expects `label`, NOT `medication_name`
        const { label, dosage, instructions, reminder_times, days_of_week, start_date, end_date } = req.body;

        if (!label || !dosage) {
            return res.status(400).json({
                success: false,
                error: 'Label (A, B, C…) and dosage are required. Medication names are never stored.'
            });
        }
        if (!LABEL_RE.test(String(label).toUpperCase())) {
            return res.status(400).json({
                success: false,
                error: 'Label must be 1–3 uppercase letters (e.g. A, B, AA).'
            });
        }

        const times = Array.isArray(reminder_times) && reminder_times.length > 0 ? reminder_times : ['08:00'];
        const days = Array.isArray(days_of_week) && days_of_week.length > 0 ? days_of_week : [0, 1, 2, 3, 4, 5, 6];

        const { data, error } = await db
            .from('medication_schedules')
            .insert({
                user_id: userId,
                medication_name: String(label).toUpperCase(), // repurposed: stores label
                dosage: dosage.trim(),
                instructions: instructions ? instructions.trim() : null,
                reminder_times: times,
                days_of_week: days,
                start_date: start_date || new Date().toISOString().split('T')[0],
                end_date: end_date || null,
                is_active: true
            })
            .select()
            .single();

        if (error) throw error;

        res.json({
            success: true,
            schedule: toScheduleResponse(data),
            message: 'Medication reminder created (label stored, name kept client-side)'
        });
    } catch (err) {
        console.error('Error creating reminder:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const { label, dosage, instructions, reminder_times, days_of_week, start_date, end_date, is_active } = req.body;

        const updateData = { updated_at: new Date().toISOString() };
        if (label !== undefined) {
            if (!LABEL_RE.test(String(label).toUpperCase())) {
                return res.status(400).json({ success: false, error: 'Label must be 1–3 uppercase letters (e.g. A, B, AA).' });
            }
            updateData.medication_name = String(label).toUpperCase();
        }
        if (dosage !== undefined) updateData.dosage = dosage.trim();
        if (instructions !== undefined) updateData.instructions = instructions;
        if (reminder_times !== undefined) updateData.reminder_times = reminder_times;
        if (days_of_week !== undefined) updateData.days_of_week = days_of_week;
        if (start_date !== undefined) updateData.start_date = start_date;
        if (end_date !== undefined) updateData.end_date = end_date;
        if (is_active !== undefined) updateData.is_active = is_active;

        const { data, error } = await db
            .from('medication_schedules')
            .update(updateData)
            .eq('id', id)
            .eq('user_id', userId)
            .select()
            .single();
        if (error) throw error;

        res.json({
            success: true,
            schedule: toScheduleResponse(data),
            message: 'Medication schedule updated successfully'
        });
    } catch (err) {
        console.error('Error updating reminder:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const { error } = await db
            .from('medication_schedules')
            .delete()
            .eq('id', id)
            .eq('user_id', userId);
        if (error) throw error;
        res.json({ success: true, message: 'Medication schedule deleted' });
    } catch (err) {
        console.error('Error deleting reminder:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/subscribe', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { endpoint, p256dh, auth, device_name } = req.body;
        if (!endpoint || !p256dh || !auth) {
            return res.status(400).json({ success: false, error: 'Subscription endpoint and keys are required' });
        }
        const { data, error } = await db
            .from('push_subscriptions')
            .upsert({
                user_id: userId,
                endpoint,
                p256dh,
                auth,
                device_name: device_name || 'Web Browser',
                last_used_at: new Date().toISOString()
            }, { onConflict: 'endpoint' })
            .select()
            .single();
        if (error) throw error;
        res.json({ success: true, message: 'Device subscribed successfully', subscription: data });
    } catch (err) {
        console.error('Error saving subscription:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/unsubscribe', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { endpoint } = req.body;
        if (endpoint) {
            await db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', userId);
        } else {
            await db.from('push_subscriptions').delete().eq('user_id', userId);
        }
        res.json({ success: true, message: 'Device unsubscribed from push notifications' });
    } catch (err) {
        console.error('Error unsubscribing device:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/test-push', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await sendTestNotification(userId);
        if (!result.success) {
            return res.status(400).json({ success: false, message: result.message || result.error || 'Failed to send test notification' });
        }
        res.json({ success: true, message: 'Test notification sent to your device!', devicesReached: result.totalDevices });
    } catch (err) {
        console.error('Error in test-push:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/:id/action', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const { action, scheduled_time } = req.body;
        const todayStr = new Date().toISOString().split('T')[0];

        const { data: existingLog } = await db
            .from('medication_reminder_logs')
            .select('id')
            .eq('schedule_id', id)
            .eq('user_id', userId)
            .eq('scheduled_date', todayStr)
            .eq('scheduled_time', scheduled_time || '08:00')
            .maybeSingle();

        if (existingLog) {
            await db.from('medication_reminder_logs')
                .update({ status: action || 'taken', action_taken_at: new Date().toISOString() })
                .eq('id', existingLog.id);
        } else {
            await db.from('medication_reminder_logs').insert({
                schedule_id: id,
                user_id: userId,
                scheduled_date: todayStr,
                scheduled_time: scheduled_time || '08:00',
                status: action || 'taken',
                action_taken_at: new Date().toISOString()
            });
        }

        res.json({ success: true, message: `Medication marked as ${action || 'taken'}` });
    } catch (err) {
        console.error('Error logging medication action:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
