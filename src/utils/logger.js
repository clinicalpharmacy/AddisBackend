
const DEBUG = process.env.DEBUG === 'true' || true;

export const debug = {
    log: (message, data = null) => {
        if (DEBUG) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] 🔍 DEBUG: ${message}`);
            if (data) {
                console.log(`[${timestamp}] 📊 DATA:`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
            }
        }
    },
    error: (message, error = null) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] ❌ ERROR: ${message}`);
        if (error) {
            console.error(`[${timestamp}] 🐛 ERROR DETAILS:`, error.message || error);
            if (error.stack && DEBUG) {
                console.error(`[${timestamp}] 🗂️ STACK TRACE:`, error.stack);
            }
        }
    },
    warn: (message, data = null) => {
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] ⚠️ WARNING: ${message}`);
        if (data) {
            console.warn(`[${timestamp}] 📋 WARNING DATA:`, data);
        }
    },
    success: (message, data = null) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ✅ SUCCESS: ${message}`);
        if (data && DEBUG) {
            console.log(`[${timestamp}] 📈 SUCCESS DATA:`, data);
        }
    }
};
