import webpush from 'web-push';
import { config } from '../config/env.js';
import { supabase, supabaseAdmin } from '../config/supabase.js';

const db = supabaseAdmin || supabase;

// Configure Web Push with VAPID keys
if (config.vapid?.publicKey && config.vapid?.privateKey) {
    webpush.setVapidDetails(
        config.vapid.subject,
        config.vapid.publicKey,
        config.vapid.privateKey
    );
    console.log('✅ Web Push service initialized with VAPID credentials');
} else {
    console.warn('⚠️ Web Push VAPID keys missing in config');
}

/**
 * Send a web push notification to a specific subscription
 */
export async function sendPushToSubscription(subscription, payload) {
    const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
        }
    };

    try {
        const result = await webpush.sendNotification(
            pushSubscription,
            JSON.stringify(payload)
        );
        return { success: true, statusCode: result.statusCode };
    } catch (error) {
        // If 410 (Gone) or 404 (Not Found), client has revoked permission or uninstalled
        if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`🗑️ Removing expired push subscription: ${subscription.id || subscription.endpoint}`);
            await db.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
        } else {
            console.error('❌ Push delivery error:', error.message);
        }
        return { success: false, error: error.message, statusCode: error.statusCode };
    }
}

/**
 * Send push notification to all devices belonging to a user
 */
export async function sendPushToUser(userId, payload) {
    try {
        const { data: subscriptions, error } = await db
            .from('push_subscriptions')
            .select('*')
            .eq('user_id', userId);

        if (error) {
            console.error('Error fetching subscriptions for user:', error);
            return { success: false, error: error.message };
        }

        if (!subscriptions || subscriptions.length === 0) {
            return { success: false, message: 'No registered devices found for user' };
        }

        const deliveryPromises = subscriptions.map(sub => sendPushToSubscription(sub, payload));
        const results = await Promise.allSettled(deliveryPromises);

        return {
            success: true,
            totalDevices: subscriptions.length,
            results
        };
    } catch (err) {
        console.error('Error in sendPushToUser:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Send immediate test notification
 */
export async function sendTestNotification(userId) {
    const payload = {
        title: '🔔 Reminders are Active!',
        body: 'Your device is successfully connected. You will receive medication alerts on time.',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: 'test-reminder',
        renotify: true,
        data: {
            url: '/reminders',
            type: 'test'
        }
    };

    return await sendPushToUser(userId, payload);
}

/**
 * Check active medication schedules and send notifications for due doses.
 * Runs every minute in cron.
 */
export async function checkAndSendDueReminders() {
    try {
        const now = new Date();
        
        // Format local HH:MM (also checking UTC in case user runs UTC server)
        const currentHours = String(now.getHours()).padStart(2, '0');
        const currentMinutes = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${currentHours}:${currentMinutes}`;
        
        // Current day of week: 0 = Sun, 1 = Mon, ..., 6 = Sat
        const currentDayOfWeek = now.getDay();
        const currentDateStr = now.toISOString().split('T')[0];

        // Fetch all active schedules
        const { data: schedules, error } = await db
            .from('medication_schedules')
            .select('*')
            .eq('is_active', true);

        if (error || !schedules || schedules.length === 0) {
            return;
        }

        for (const schedule of schedules) {
            // Check start_date and end_date
            if (schedule.start_date && schedule.start_date > currentDateStr) continue;
            if (schedule.end_date && schedule.end_date < currentDateStr) continue;

            // Check days of week
            const daysOfWeek = Array.isArray(schedule.days_of_week) ? schedule.days_of_week : [0,1,2,3,4,5,6];
            if (!daysOfWeek.includes(currentDayOfWeek)) continue;

            // Check reminder times
            const reminderTimes = Array.isArray(schedule.reminder_times) ? schedule.reminder_times : [];
            const isDueNow = reminderTimes.some(time => {
                if (typeof time !== 'string') return false;
                // Match "HH:MM"
                return time.startsWith(currentTime);
            });

            if (!isDueNow) continue;

            // Check if already sent today for this time
            const { data: existingLog } = await db
                .from('medication_reminder_logs')
                .select('id')
                .eq('schedule_id', schedule.id)
                .eq('scheduled_date', currentDateStr)
                .eq('scheduled_time', currentTime)
                .maybeSingle();

            if (existingLog) {
                // Already dispatched this reminder
                continue;
            }

            // Create log record
            await db.from('medication_reminder_logs').insert({
                schedule_id: schedule.id,
                user_id: schedule.user_id,
                scheduled_time: currentTime,
                scheduled_date: currentDateStr,
                status: 'sent'
            });

            // Dispatch Push Notification
            const payload = {
                title: `💊 Time for ${schedule.medication_name}`,
                body: `Dose: ${schedule.dosage}${schedule.instructions ? ' • ' + schedule.instructions : ''}`,
                icon: '/pwa-192x192.png',
                badge: '/pwa-192x192.png',
                tag: `reminder-${schedule.id}-${currentTime}`,
                renotify: true,
                requireInteraction: true,
                data: {
                    scheduleId: schedule.id,
                    medicationName: schedule.medication_name,
                    dosage: schedule.dosage,
                    scheduledTime: currentTime,
                    url: '/reminders'
                },
                actions: [
                    { action: 'take', title: '✅ Taken' },
                    { action: 'snooze', title: '⏰ Snooze 15m' }
                ]
            };

            console.log(`📢 Dispatching reminder for "${schedule.medication_name}" to user ${schedule.user_id}`);
            await sendPushToUser(schedule.user_id, payload);
        }
    } catch (err) {
        console.error('Error during checkAndSendDueReminders:', err.message);
    }
}
