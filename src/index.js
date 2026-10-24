import app from './app.js';
import { config } from './config/env.js';
import { debug } from './utils/logger.js';
import { initReminderScheduler } from './services/reminderScheduler.js';

const PORT = config.port || 5000;

app.listen(PORT, () => {
    debug.success(`Server running on port ${PORT}`);
    debug.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Start background reminder worker
    initReminderScheduler();
});

