import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';

// Authentication middleware
export const authenticateToken = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Access token required'
            });
        }

        const user = jwt.verify(token, config.jwtSecret);
        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            error: 'Invalid or expired token'
        });
    }
};

// Admin middleware
export const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        return res.status(403).json({
            success: false,
            error: 'Admin access required.',
            user_role: req.user.role,
            required_role: 'admin'
        });
    }

    next();
};

export const requireCompanyAdmin = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        if (req.user.role === 'company_admin') {
            return next();
        }
        return res.status(403).json({ success: false, error: 'Company admin access required' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
};

// Check if user has access to patient
export async function checkUserPatientAccess(userId, patientId, userRole) {
    try {
        if (userRole === 'admin' || userRole === 'superadmin') {
            return true;
        }

        if (!supabase) return false;

        // For regular users, check direct ownership (Company logic handled by getUserAccessibleData in routes)
        const { data: patient } = await supabase
            .from('patients')
            .select('user_id')
            .eq('id', patientId)
            .eq('user_id', userId)
            .single();

        return !!patient;
    } catch (error) {
        return false;
    }
}

export const checkPatientOwnership = async (req, res, next) => {
    try {
        const hasAccess = await checkUserPatientAccess(req.user.userId, req.params.id, req.user.role);
        if (!hasAccess) return res.status(403).json({ success: false, error: 'Access denied' });
        next();
    } catch (error) {
        res.status(500).json({ success: false, error: 'Server error' });
    }
};

// Get patient limit based on user role
export function getPatientLimit(user) {
    if (!user) return 1; // Default fallback
    
    const userRole = user.role;
    const userAccountType = user.account_type || 'individual';
    const hasCompanyId = !!user.company_id;
    
    // Admins have no limit
    if (userRole === 'admin' || userRole === 'superadmin') {
        return Infinity;
    }
    
    // Company users have no limit
    if (userAccountType === 'company' || hasCompanyId || 
        userAccountType === 'company_user' || userRole === 'company_admin') {
        return Infinity;
    }
    
    // Individual users have limits based on role
    if (userAccountType === 'individual') {
        if (userRole === 'pharmacist' || userRole === 'pharmacy_student') {
            return 5; // Pharmacists and pharmacy students: 5 patients
        } else {
            return 1; // Other individual users: 1 patient
        }
    }
    
    // Default fallback
    return 1;
}

// Get user-friendly limit message
export function getPatientLimitMessage(user) {
    if (!user) return 'Unable to determine patient limit.';
    
    const limit = getPatientLimit(user);
    const userRole = user.role;
    const userAccountType = user.account_type || 'individual';
    
    if (limit === Infinity) {
        if (userRole === 'admin' || userRole === 'superadmin') {
            return 'Administrators have unlimited patient access.';
        }
        if (userAccountType === 'company' || user.company_id) {
            return 'Company users have unlimited patient access.';
        }
    }
    
    if (userRole === 'pharmacist' || userRole === 'pharmacy_student') {
        return `As a ${userRole}, you can manage up to ${limit} patients.`;
    }
    
    if (userAccountType === 'individual') {
        return `Individual users are limited to ${limit} patient. Upgrade to Company subscription for unlimited patients.`;
    }
    
    return `You are limited to ${limit} patient${limit > 1 ? 's' : ''}.`;
}

// Check if user can add more patients
export async function checkPatientLimit(user, supabaseClient = supabase) {
    try {
        if (!user || !supabaseClient) {
            return { canAdd: false, error: 'Invalid user or database connection' };
        }
        
        const limit = getPatientLimit(user);
        
        // If limit is Infinity, user can always add more
        if (limit === Infinity) {
            return { 
                canAdd: true, 
                limit: 'unlimited',
                current: 0,
                message: getPatientLimitMessage(user)
            };
        }
        
        // Get current patient count
        const { count, error } = await supabaseClient
            .from('patients')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.userId);
            
        if (error) {
            console.error('Error checking patient limit:', error);
            return { canAdd: false, error: 'Failed to check patient limit' };
        }
        
        const currentCount = count || 0;
        const canAdd = currentCount < limit;
        
        return {
            canAdd,
            limit,
            current: currentCount,
            remaining: Math.max(0, limit - currentCount),
            message: getPatientLimitMessage(user)
        };
    } catch (error) {
        console.error('Error in checkPatientLimit:', error);
        return { canAdd: false, error: 'Server error checking patient limit' };
    }
}

// Middleware to check patient limit before creating new patient
export const requirePatientLimit = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        const limitCheck = await checkPatientLimit(req.user, supabase);
        
        if (!limitCheck.canAdd) {
            const limit = getPatientLimit(req.user);
            
            return res.status(403).json({
                success: false,
                error: 'Patient limit reached',
                message: limitCheck.error || getPatientLimitMessage(req.user),
                limit: limit === Infinity ? 'unlimited' : limit,
                current: limitCheck.current || 0,
                remaining: limitCheck.remaining || 0,
                role: req.user.role,
                account_type: req.user.account_type
            });
        }
        
        // Attach limit info to request for potential use in route
        req.patientLimitInfo = limitCheck;
        next();
    } catch (error) {
        console.error('Error in requirePatientLimit middleware:', error);
        res.status(500).json({
            success: false,
            error: 'Server error checking patient limit'
        });
    }
};

export async function getUserAccessibleData(userId, userRole, userCompanyId, userAccountType = 'individual') {
    try {
        const db = (typeof supabaseAdmin !== 'undefined' ? supabaseAdmin : supabase);
        
        // 1. SUPERADMIN
        if (userRole === 'superadmin') return null;

        // 2. ADMIN
        if (userRole === 'admin') {
            const { data } = await db.from('users').select('id');
            return data?.map(u => u.id) || [userId];
        }

        // 3. COMPANY CONTEXT (Pharmacists, Staff, etc.)
        let companyId = userCompanyId;
        const companyRoles = ['company_user', 'company_admin', 'pharmacist', 'healthcare_client'];
        
        if (!companyId && (companyRoles.includes(userRole) || companyRoles.includes(userAccountType))) {
            // Aggressive lookup across all user tables
            const { data: cu } = await db.from('company_users').select('company_id').eq('id', userId).maybeSingle();
            companyId = cu?.company_id;
            
            if (!companyId) {
                const { data: u } = await db.from('users').select('company_id').eq('id', userId).maybeSingle();
                companyId = u?.company_id;
            }
            
            if (!companyId) {
                const { data: s } = await db.from('social_users').select('company_id').eq('id', userId).maybeSingle();
                companyId = s?.company_id;
            }
        }

        if (companyId) {
            const [{ data: users }, { data: companyUsers }] = await Promise.all([
                db.from('users').select('id').eq('company_id', companyId),
                db.from('company_users').select('id').eq('company_id', companyId)
            ]);
            
            const allIds = [
                ...(users?.map(u => u.id) || []),
                ...(companyUsers?.map(u => u.id) || [])
            ];
            if (!allIds.includes(userId)) allIds.push(userId);
            return allIds;
        }

        // 4. INDIVIDUAL / PERSONAL CONTEXT (Fallback)
        const activeIds = [userId];
        try {
            const { data: userRecord } = await db.from('users').select('id, healthcare_client_id').eq('id', userId).maybeSingle();
            if (userRecord?.healthcare_client_id && !activeIds.includes(userRecord.healthcare_client_id)) {
                activeIds.push(userRecord.healthcare_client_id);
            }
            if (!userRecord && typeof userId === 'string' && userId.startsWith('HCC-')) {
                // already in list
            }
        } catch (e) {
            console.warn('⚠️ [DATA ISOLATION] User-HCC mapping lookup failed:', e.message);
        }

        return activeIds;

    } catch (error) {
        console.error('❌ [DATA ISOLATION] Critical Error:', error);
        return [userId];
    }
}
