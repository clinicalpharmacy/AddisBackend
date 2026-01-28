import { debug } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
    debug.log(`${req.method} ${req.path}`);
    next();
};
