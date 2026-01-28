import { debug } from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
    debug.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        timestamp: new Date().toISOString()
    });
};
