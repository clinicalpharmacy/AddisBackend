import { debug } from './logger.js';

// Validate email format
export function isValidEmail(email) {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

// Calculate end date for subscription
export function calculateEndDate(planId) {
    debug.log(`Calculating end date for plan: ${planId}`);
    const endDate = new Date();

    if (planId === 'individual_monthly' || planId === 'company_basic') {
        // EXACTLY 30 days
        endDate.setDate(endDate.getDate() + 30);
    } else if (planId === 'individual_yearly' || planId === 'company_pro') {
        // EXACTLY 365 days
        endDate.setDate(endDate.getDate() + 365);
    } else {
        // Default to 30 days if plan unknown
        endDate.setDate(endDate.getDate() + 30);
    }

    const result = endDate.toISOString();
    debug.log(`End date calculated: ${result}`);
    return result;
}

// Get plan details
export function getPlanDetails(planId) {
    const plans = {
        'individual_monthly': {
            name: 'Individual Monthly',
            price: 300,
            interval: 'month',
            user_limit: 1,
            currency: 'ETB'
        },
        'individual_yearly': {
            name: 'Individual Yearly',
            price: 3000,
            interval: 'year',
            user_limit: 1,
            currency: 'ETB'
        },
        'company_basic': {
            name: 'Company Monthly',
            price: 3000,
            interval: 'month',
            user_limit: 5,
            currency: 'ETB'
        },
        'company_pro': {
            name: 'Company Yearly',
            price: 25000,
            interval: 'year',
            user_limit: 20,
            currency: 'ETB'
        }
    };

    const plan = plans[planId];
    debug.log(`Plan details for ${planId}:`, plan);
    return plan || null;
}

// Generate unique transaction reference
export function generateTransactionReference() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ref = `pharmacare_${timestamp}_${random}`;
    debug.log(`Generated transaction reference: ${ref}`);
    return ref;
}

// Generate unique patient code
export function generatePatientCode() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `PAT-${timestamp}-${random}`;
    debug.log(`Generated patient code: ${code}`);
    return code;
}

// Sanitize search query
export function sanitizeSearchQuery(query) {
    if (!query) return '';
    const sanitized = query
        .replace(/[;'"\\]/g, '')
        .trim()
        .slice(0, 100);
    debug.log(`Sanitized search query: "${query}" -> "${sanitized}"`);
    return sanitized;
}
