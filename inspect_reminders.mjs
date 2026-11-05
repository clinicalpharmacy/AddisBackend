import { sendTestNotification } from './src/services/reminderService.js';

async function testPush() {
    const res = await sendTestNotification('4795affa-3c5a-4cc8-890a-c006d7e3d2a9');
    console.log('sendTestNotification result:', JSON.stringify(res, null, 2));
    process.exit(0);
}

testPush();
