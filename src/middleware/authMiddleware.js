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

// Data access isolation helper (from server.js)
export async function getUserAccessibleData(userId, userRole, userCompanyId, userAccountType = 'individual') {
    try {
        const db = (typeof supabaseAdmin !== 'undefined' ? supabaseAdmin : supabase);
        
        // 1. SUPERADMIN - Full bypass (returns null)
        if (userRole === 'superadmin') {
            return null;
        }

        // 2. ADMIN - Sees everything 
        if (userRole === 'admin') {
            const { data: allUsers } = await db.from('users').select('id');
            const userIds = allUsers?.map(u => u.id) || [userId];
            return userIds;
        }

        let companyId = userCompanyId;

        // If company_id isn't provided, try to find it using Admin client to bypass RLS
        if (!companyId) {
            if (userAccountType === 'company_user' || userRole === 'company_user' || userRole === 'healthcare_client') {
                const { data: cu } = await db.from('company_users').select('company_id').eq('id', userId).maybeSingle();
                companyId = cu?.company_id;
            } 
            
            if (!companyId) {
                const { data: u } = await db.from('users').select('company_id').eq('id', userId).maybeSingle();
                companyId = u?.company_id;
            }
        }

        // 2 & 3. COMPANY USERS & ADMINS - Return all IDs in the same company
        if (companyId) {
            // Get all users from both tables sharing this company_id
            const [{ data: users }, { data: companyUsers }] = await Promise.all([
                db.from('users').select('id').eq('company_id', companyId),
                db.from('company_users').select('id').eq('company_id', companyId)
            ]);

            const allIdsInCompany = [
                ...(users?.map(u => u.id) || []),
                ...(companyUsers?.map(u => u.id) || [])
            ];

            // Ensure current user is in the list
            if (userId && !allIdsInCompany.includes(userId)) allIdsInCompany.push(userId);

            return allIdsInCompany;
        }

        // 4. INDIVIDUALS / HEALTHCARE CLIENTS - See their own data
        // For healthcare clients, we need to find if there's an associated HCC string ID
        const activeIds = [userId];
        
        try {
            // Check users table for additional identifiers (like HCC- strings)
            const { data: u } = await db.from('users').select('id, healthcare_client_id').eq('id', userId).maybeSingle();
            
            if (u) {
                // If the user's UUID is linked to an HCC ID, include both
                if (u.healthcare_client_id && !activeIds.includes(u.healthcare_client_id)) {
                    activeIds.push(u.healthcare_client_id);
                }
            }
            
            // If the current user's ID was NOT found by UUID, maybe the ID IS the HCC string
            if (!u && typeof userId === 'string' && userId.startsWith('HCC-')) {
                // This is already in activeIds
            }
        } catch (e) {
            console.warn('⚠️ [DATA ISOLATION] User lookup failed for IDs:', e.message);
        }

        return activeIds;

    } catch (error) {
        console.error('❌ [DATA ISOLATION] Error:', error);
        return [userId]; // Fallback to self-only
    }
}
