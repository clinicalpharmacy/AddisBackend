import { debug } from './logger.js';

// Validate email format (strict)
export function isValidEmail(email) {
    if (!email) return false;
    // Requires: at least 2 chars before @, proper domain structure, 2-6 char TLD
    const emailRegex = /^[a-zA-Z0-9._%+-]{2,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
    return emailRegex.test(email.trim());
}

// Monthly plan IDs (30 days), yearly plan IDs (365 days)
const MONTHLY_PLAN_IDS = [
    'individual_monthly', 'company_basic',
    'pharmacy_monthly', 'clinic_monthly', 'health_center_monthly',
    'hospital_monthly', 'pharmacy_school_monthly'
];
const YEARLY_PLAN_IDS = [
    'individual_yearly', 'company_pro',
    'pharmacy_yearly', 'clinic_yearly', 'health_center_yearly',
    'hospital_yearly', 'pharmacy_school_yearly'
];

// Calculate end date for subscription
export function calculateEndDate(planId) {
    debug.log(`Calculating end date for plan: ${planId}`);
    const endDate = new Date();

    if (MONTHLY_PLAN_IDS.includes(planId)) {
        // EXACTLY 30 days
        endDate.setDate(endDate.getDate() + 30);
    } else if (YEARLY_PLAN_IDS.includes(planId)) {
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
        // ── Legacy / backward-compatible plan IDs ──────────────────────────
        'individual_monthly': {
            name: 'Individual Monthly',
            price: 345, // 300 + 15% VAT
            interval: 'month',
            user_limit: 1,
            currency: 'ETB'
        },
        'individual_yearly': {
            name: 'Individual Yearly',
            price: 3450, // 3000 + 15% VAT
            interval: 'year',
            user_limit: 1,
            currency: 'ETB'
        },
        'company_basic': {
            name: 'Company Monthly',
            price: 3450, // 3000 + 15% VAT
            interval: 'month',
            user_limit: 5,
            currency: 'ETB'
        },
        'company_pro': {
            name: 'Company Yearly',
            price: 28750, // 25000 + 15% VAT
            interval: 'year',
            user_limit: 20,
            currency: 'ETB'
        },
        // ── Pharmacy / Drug Store ──────────────────────────────────────────
        'pharmacy_monthly': {
            name: 'Pharmacy / Drug Store Monthly',
            price: 1035, // 900 + 15% VAT
            interval: 'month',
            user_limit: 5,
            currency: 'ETB'
        },
        'pharmacy_yearly': {
            name: 'Pharmacy / Drug Store Yearly',
            price: 10350, // 9000 + 15% VAT
            interval: 'year',
            user_limit: 5,
            currency: 'ETB'
        },
        // ── Clinic / Specialty Center ──────────────────────────────────────
        'clinic_monthly': {
            name: 'Clinic / Specialty Center Monthly',
            price: 1035, // 900 + 15% VAT
            interval: 'month',
            user_limit: 5,
            currency: 'ETB'
        },
        'clinic_yearly': {
            name: 'Clinic / Specialty Center Yearly',
            price: 10350, // 9000 + 15% VAT
            interval: 'year',
            user_limit: 5,
            currency: 'ETB'
        },
        // ── Health Center ──────────────────────────────────────────────────
        'health_center_monthly': {
            name: 'Health Center Monthly',
            price: 1035, // 900 + 15% VAT
            interval: 'month',
            user_limit: 5,
            currency: 'ETB'
        },
        'health_center_yearly': {
            name: 'Health Center Yearly',
            price: 10350, // 9000 + 15% VAT
            interval: 'year',
            user_limit: 5,
            currency: 'ETB'
        },
        // ── Hospital ──────────────────────────────────────────────────────
        'hospital_monthly': {
            name: 'Hospital Monthly',
            price: 3450, // 3000 + 15% VAT
            interval: 'month',
            user_limit: 20,
            currency: 'ETB'
        },
        'hospital_yearly': {
            name: 'Hospital Yearly',
            price: 28750, // 25000 + 15% VAT
            interval: 'year',
            user_limit: 20,
            currency: 'ETB'
        },
        // ── Pharmacy School ────────────────────────────────────────────────
        'pharmacy_school_monthly': {
            name: 'Pharmacy School Monthly',
            price: 3450, // 3000 + 15% VAT
            interval: 'month',
            user_limit: 20,
            currency: 'ETB'
        },
        'pharmacy_school_yearly': {
            name: 'Pharmacy School Yearly',
            price: 28750, // 25000 + 15% VAT
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
