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

    if (req.user.role !== 'admin') {
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
        if (userRole === 'admin') {
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

// Data access isolation helper (from server.js)
export async function getUserAccessibleData(userId, userRole, userCompanyId, userAccountType = 'individual') {
    try {
        // 1. ADMIN - Sees everything
        if (userRole === 'admin') {
            return null;
        }

        let companyId = userCompanyId;

        // If company_id isn't provided, try to find it
        if (!companyId) {
            if (userAccountType === 'company_user' || userRole === 'company_user') {
                const { data: cu } = await supabase.from('company_users').select('company_id').eq('id', userId).maybeSingle();
                companyId = cu?.company_id;
            } else {
                const { data: u } = await supabase.from('users').select('company_id').eq('id', userId).maybeSingle();
                companyId = u?.company_id;
            }
        }

        // 2 & 3. COMPANY USERS & ADMINS - Return all IDs in the same company
        if (companyId) {
            // Get all users from both tables sharing this company_id
            const [{ data: users }, { data: companyUsers }] = await Promise.all([
                supabase.from('users').select('id').eq('company_id', companyId),
                supabase.from('company_users').select('id').eq('company_id', companyId)
            ]);

            const allIdsInCompany = [
                ...(users?.map(u => u.id) || []),
                ...(companyUsers?.map(u => u.id) || [])
            ];

            // Ensure current user is in the list
            if (!allIdsInCompany.includes(userId)) allIdsInCompany.push(userId);

            return allIdsInCompany;
        }

        // 4. INDIVIDUALS - Only see their own data
        return [userId];

    } catch (error) {
        console.error('❌ [DATA ISOLATION] Error:', error);
        return [userId]; // Fallback to self-only
    }
}
