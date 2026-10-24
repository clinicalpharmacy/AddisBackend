import cron from 'node-cron';
import { checkAndSendDueReminders } from './reminderService.js';

/**
 * Initializes the background cron job to dispatch medication reminders
 */
export function initReminderScheduler() {
    console.log('⏰ Initializing Medication Reminder Scheduler (runs every minute)...');

    // Run every minute: '* * * * *'
    cron.schedule('* * * * *', async () => {
        try {
            await checkAndSendDueReminders();
        } catch (err) {
            console.error('❌ Error executing reminder scheduler:', err.message);
        }
    });

    console.log('✅ Medication Reminder Scheduler active');
}
