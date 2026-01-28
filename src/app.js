import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';

// Import Routes
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import clinicalRoutes from './routes/clinicalRoutes.js';
import medicationRoutes from './routes/medicationRoutes.js';
import companyRoutes from './routes/companyRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import utilityRoutes from './routes/utilityRoutes.js';
import debugRoutes from './routes/debugRoutes.js';
import performanceRoutes from './routes/performanceRoutes.js';
import medicationReconciliationRoutes from './routes/medicationReconciliationRoutes.js';
import linkRoutes from './routes/linkRoutes.js';
import availabilityRoutes from './routes/availabilityRoutes.js';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
    origin: config.frontendUrl || '*',
    credentials: true
}));
app.use(express.json());
app.use(requestLogger);

// Basic Routes
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to Addis Clinical API',
        version: '1.0.0',
        status: 'operational'
    });
});

app.get('/api', (req, res) => {
    res.json({
        success: true,
        message: 'Addis Clinical API Base Endpoint',
        endpoints: [
            '/api/auth',
            '/api/patients',
            '/api/clinical',
            '/api/medications'
        ]
    });
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/debug', debugRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/medication-reconciliation', medicationReconciliationRoutes);

// Mixed routes mounted at /api
app.use('/api', clinicalRoutes);
app.use('/api', medicationRoutes);
app.use('/api', paymentRoutes);
app.use('/api', utilityRoutes);
app.use('/api', linkRoutes);
app.use('/api', availabilityRoutes);

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found', path: req.path });
});

// Error Handler
app.use(errorHandler);

export default app;
