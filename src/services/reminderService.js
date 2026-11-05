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
        body: 'Your device is verified and connected to receive scheduled medication alerts.',
        icon: '/logo.png',
        badge: '/favicon-48x48.png',
        tag: 'device-verification',
        renotify: true,
        data: {
            url: '/reminders',
            type: 'verification'
        }
    };

    return await sendPushToUser(userId, payload);
}

/**
 * Check active medication schedules and send notifications for due doses.
 * Timezone-aware (defaults to Africa/Addis_Ababa UTC+3).
 */
export async function checkAndSendDueReminders() {
    try {
        const now = new Date();

        // Fetch all active schedules
        const { data: schedules, error } = await db
            .from('medication_schedules')
            .select('*')
            .eq('is_active', true);

        if (error || !schedules || schedules.length === 0) {
            return;
        }

        for (const schedule of schedules) {
            // Determine user timezone (default to Africa/Addis_Ababa UTC+3)
            const tz = schedule.timezone || 'Africa/Addis_Ababa';
            let localTime = '';
            let localDate = '';
            let localDayOfWeek = 0;

            try {
                const timeFmt = new Intl.DateTimeFormat('en-GB', {
                    timeZone: tz,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                localTime = timeFmt.format(now); // "HH:MM"

                const dateFmt = new Intl.DateTimeFormat('en-CA', {
                    timeZone: tz,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });
                localDate = dateFmt.format(now); // "YYYY-MM-DD"

                const dayFmt = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    weekday: 'short'
                });
                const dayName = dayFmt.format(now);
                const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
                localDayOfWeek = dayMap[dayName] ?? now.getDay();
            } catch (e) {
                // Fallback to UTC+3
                const eatDate = new Date(now.getTime() + 3 * 3600 * 1000);
                const h = String(eatDate.getUTCHours()).padStart(2, '0');
                const m = String(eatDate.getUTCMinutes()).padStart(2, '0');
                localTime = `${h}:${m}`;
                localDate = eatDate.toISOString().split('T')[0];
                localDayOfWeek = eatDate.getUTCDay();
            }

            // Check start_date and end_date
            if (schedule.start_date && schedule.start_date > localDate) continue;
            if (schedule.end_date && schedule.end_date < localDate) continue;

            // Check days of week
            const daysOfWeek = Array.isArray(schedule.days_of_week) ? schedule.days_of_week : [0, 1, 2, 3, 4, 5, 6];
            if (!daysOfWeek.includes(localDayOfWeek)) continue;

            // Check reminder times (allow exact match or within 5 minutes tolerance)
            const reminderTimes = Array.isArray(schedule.reminder_times) ? schedule.reminder_times : [];
            const [nowH, nowM] = localTime.split(':').map(Number);

            const matchedTime = reminderTimes.find(time => {
                if (typeof time !== 'string') return false;
                if (time.startsWith(localTime)) return true;
                const [sH, sM] = time.split(':').map(Number);
                if (!isNaN(sH) && !isNaN(sM) && !isNaN(nowH) && !isNaN(nowM)) {
                    const diff = (nowH * 60 + nowM) - (sH * 60 + sM);
                    return diff >= 0 && diff <= 5;
                }
                return false;
            });

            if (!matchedTime) continue;

            // Check if already dispatched today for this scheduled time
            const { data: existingLog } = await db
                .from('medication_reminder_logs')
                .select('id')
                .eq('schedule_id', schedule.id)
                .eq('scheduled_date', localDate)
                .eq('scheduled_time', matchedTime)
                .maybeSingle();

            if (existingLog) {
                continue;
            }

            // Create log record
            await db.from('medication_reminder_logs').insert({
                schedule_id: schedule.id,
                user_id: schedule.user_id,
                scheduled_time: matchedTime,
                scheduled_date: localDate,
                status: 'sent'
            });

            // Dispatch Push Notification
            const medName = schedule.medication_name || schedule.label || 'Medication';
            const doseText = schedule.dosage ? `Dose: ${schedule.dosage}` : '';
            const instructionText = schedule.instructions ? ` • ${schedule.instructions}` : '';

            const payload = {
                title: `💊 Time for ${medName}`,
                body: `${doseText}${instructionText}`.trim() || 'It is time for your scheduled medication dose.',
                icon: '/logo.png',
                badge: '/favicon-48x48.png',
                tag: `reminder-${schedule.id}-${matchedTime}`,
                renotify: true,
                requireInteraction: true,
                data: {
                    scheduleId: schedule.id,
                    medicationName: medName,
                    dosage: schedule.dosage || '',
                    scheduledTime: matchedTime,
                    url: '/reminders'
                },
                actions: [
                    { action: 'taken', title: '✅ Taken' },
                    { action: 'open', title: '👀 View' }
                ]
            };

            console.log(`📢 Dispatching reminder for "${medName}" (${matchedTime}) to user ${schedule.user_id}`);
            await sendPushToUser(schedule.user_id, payload);
        }
    } catch (err) {
        console.error('Error during checkAndSendDueReminders:', err.message);
    }
}
