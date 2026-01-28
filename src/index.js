import app from './app.js';
import { config } from './config/env.js';
import { debug } from './utils/logger.js';

const PORT = config.port || 5000;

app.listen(PORT, () => {
    debug.success(`Server running on port ${PORT}`);
    debug.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
