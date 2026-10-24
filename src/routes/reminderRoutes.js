import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { config } from '../config/env.js';
import {
    sendTestNotification,
    sendPushToUser
} from '../services/reminderService.js';

const router = express.Router();
const db = supabaseAdmin || supabase;

/**
 * Public VAPID Key for frontend PushManager subscription
 */
router.get('/vapid-public-key', (req, res) => {
    res.json({
        success: true,
        publicKey: config.vapid?.publicKey || ''
    });
});

/**
 * Get all medication schedules and today's logs for logged-in user
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const todayStr = new Date().toISOString().split('T')[0];

        // 1. Fetch schedules
        const { data: schedules, error: schedErr } = await db
            .from('medication_schedules')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (schedErr) throw schedErr;

        // 2. Fetch today's logs for adherence status
        const { data: todayLogs, error: logErr } = await db
            .from('medication_reminder_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('scheduled_date', todayStr);

        if (logErr) throw logErr;

        // 3. Check if user has active push subscriptions
        const { count: subscriptionCount } = await db
            .from('push_subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        res.json({
            success: true,
            schedules: schedules || [],
            todayLogs: todayLogs || [],
            hasActiveDevices: (subscriptionCount || 0) > 0,
            deviceCount: subscriptionCount || 0
        });
    } catch (err) {
        console.error('Error fetching reminders:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Create a new medication reminder schedule
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            medication_name,
            dosage,
            instructions,
            reminder_times,
            days_of_week,
            start_date,
            end_date
        } = req.body;

        if (!medication_name || !dosage) {
            return res.status(400).json({
                success: false,
                error: 'Medication name and dosage are required'
            });
        }

        const times = Array.isArray(reminder_times) && reminder_times.length > 0
            ? reminder_times
            : ['08:00'];

        const days = Array.isArray(days_of_week) && days_of_week.length > 0
            ? days_of_week
            : [0, 1, 2, 3, 4, 5, 6];

        const { data, error } = await db
            .from('medication_schedules')
            .insert({
                user_id: userId,
                medication_name: medication_name.trim(),
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
            schedule: data,
            message: 'Medication schedule created successfully'
        });
    } catch (err) {
        console.error('Error creating reminder:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Update an existing medication reminder schedule
 */
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const {
            medication_name,
            dosage,
            instructions,
            reminder_times,
            days_of_week,
            start_date,
            end_date,
            is_active
        } = req.body;

        const updateData = { updated_at: new Date().toISOString() };
        if (medication_name !== undefined) updateData.medication_name = medication_name.trim();
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
            schedule: data,
            message: 'Medication schedule updated successfully'
        });
    } catch (err) {
        console.error('Error updating reminder:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Delete a medication reminder schedule
 */
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

        res.json({
            success: true,
            message: 'Medication schedule deleted'
        });
    } catch (err) {
        console.error('Error deleting reminder:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Save device Web Push subscription
 */
router.post('/subscribe', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { endpoint, p256dh, auth, device_name } = req.body;

        if (!endpoint || !p256dh || !auth) {
            return res.status(400).json({
                success: false,
                error: 'Subscription endpoint and keys are required'
            });
        }

        // Upsert subscription
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

        res.json({
            success: true,
            message: 'Device subscribed to medication reminders successfully',
            subscription: data
        });
    } catch (err) {
        console.error('Error saving subscription:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Unsubscribe a device
 */
router.post('/unsubscribe', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { endpoint } = req.body;

        if (endpoint) {
            await db.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', userId);
        } else {
            // Remove all devices for this user
            await db.from('push_subscriptions').delete().eq('user_id', userId);
        }

        res.json({
            success: true,
            message: 'Device unsubscribed from push notifications'
        });
    } catch (err) {
        console.error('Error unsubscribing device:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Send a test push notification to user's registered devices
 */
router.post('/test-push', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await sendTestNotification(userId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message || result.error || 'Failed to send test notification'
            });
        }

        res.json({
            success: true,
            message: 'Test notification sent to your device!',
            devicesReached: result.totalDevices
        });
    } catch (err) {
        console.error('Error in test-push:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Record action taken on a medication (Taken, Snoozed, Skipped)
 */
router.post('/:id/action', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const { action, scheduled_time } = req.body; // action: 'taken' | 'snoozed' | 'skipped'
        const todayStr = new Date().toISOString().split('T')[0];

        // Find existing log or insert new
        const { data: existingLog } = await db
            .from('medication_reminder_logs')
            .select('id')
            .eq('schedule_id', id)
            .eq('user_id', userId)
            .eq('scheduled_date', todayStr)
            .eq('scheduled_time', scheduled_time || '08:00')
            .maybeSingle();

        if (existingLog) {
            await db.from('medication_reminder_logs').update({
                status: action || 'taken',
                action_taken_at: new Date().toISOString()
            }).eq('id', existingLog.id);
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

        res.json({
            success: true,
            message: `Medication marked as ${action || 'taken'}`
        });
    } catch (err) {
        console.error('Error logging medication action:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

export default router;
