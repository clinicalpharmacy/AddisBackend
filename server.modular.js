import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './src/config/env.js';
import { debug } from './src/utils/logger.js';

// Routes
import healthRoutes from './src/routes/healthRoutes.js';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        const allowed = ['http://localhost:5173', 'http://localhost:3000', 'https://addisfrontend.vercel.app'];
        if (allowed.indexOf(origin) === -1) {
            return callback(new Error('CORS policy violation'), false);
        }
        return callback(null, true);
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug logging
app.use((req, res, next) => {
    if (config.debug) debug.log(`📥 ${req.method} ${req.url}`);
    next();
});

// Mount Routes
app.use('/api', healthRoutes);

// Start Server
app.listen(config.port, () => {
    debug.success(`🚀 Server running on port ${config.port}`);
});
