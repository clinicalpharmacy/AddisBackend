import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { debug } from '../utils/logger.js';
import { supabase } from '../config/supabase.js';

// Authentication middleware
export const authenticateToken = (req, res, next) => {
    try {
        debug.log('Authenticating token...');
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            debug.warn('No access token provided');
            return res.status(401).json({
                success: false,
                error: 'Access token required'
            });
        }

        debug.log('Verifying JWT token...');
        const user = jwt.verify(token, config.jwtSecret);
        debug.success('Token verified successfully', { userId: user.userId, email: user.email });
        req.user = user;
        next();
    } catch (error) {
        debug.error('Token verification failed:', error);
        return res.status(403).json({
            success: false,
            error: 'Invalid or expired token'
        });
    }
};

// Admin middleware
export const requireAdmin = (req, res, next) => {
    console.log('🔐 [AUTH] Checking admin access for user:', {
        userId: req.user?.userId,
        email: req.user?.email,
        role: req.user?.role
    });

    if (!req.user) {
        console.log('❌ [AUTH] No user found in request');
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    if (req.user.role !== 'admin') {
        console.log(`🚨 [AUTH] ACCESS DENIED: User ${req.user.email} (role: ${req.user.role}) is NOT admin!`);
        return res.status(403).json({
            success: false,
            error: 'Admin access required.',
            user_role: req.user.role,
            required_role: 'admin'
        });
    }

    console.log(`✅ [AUTH] Admin access granted for: ${req.user.email}`);
    next();
};

export const requireCompanyAdmin = async (req, res, next) => {
    try {
        debug.log('Checking company admin access...');
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
        debug.log(`Checking patient access: User ${userId}, Patient ${patientId}, Role ${userRole}`);

        if (userRole === 'admin') {
            debug.log('Admin user has full access');
            return true;
        }

        if (!supabase) {
            debug.error('Supabase not available for access check');
            return false;
        }

        // For company admin, check if patient belongs to same company
        if (userRole === 'company_admin') {
            debug.log('Checking company admin access...');

            // Get user's company
            const { data: user } = await supabase
                .from('users')
                .select('company_id')
                .eq('id', userId)
                .single();

            if (!user || !user.company_id) {
                debug.warn('Company admin has no company assigned');
                return false;
            }

            // Get patient's user and their company
            const { data: patientData } = await supabase
                .from('patients')
                .select('user_id')
                .eq('id', patientId)
                .single();

            if (!patientData) {
                debug.warn('Patient not found');
                return false;
            }

            const { data: patientUser } = await supabase
                .from('users')
                .select('company_id')
                .eq('id', patientData.user_id)
                .single();

            const hasAccess = patientUser && patientUser.company_id === user.company_id;
            debug.log(`Company admin access: ${hasAccess}`);
            return hasAccess;
        }

        // For regular users, check direct ownership
        debug.log('Checking direct patient ownership...');
        const { data: patient } = await supabase
            .from('patients')
            .select('user_id')
            .eq('id', patientId)
            .eq('user_id', userId)
            .single();

        const hasAccess = !!patient;
        debug.log(`Regular user access: ${hasAccess}`);
        return hasAccess;

    } catch (error) {
        debug.error('Patient access check error:', error);
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
        console.log(`🔐 [DATA ISOLATION] Request from:`, {
            userId,
            userRole,
            userCompanyId: userCompanyId || 'none',
            userAccountType
        });

        // 1. ADMIN - Sees everything
        if (userRole === 'admin') {
            console.log('👑 Admin accessing ALL data');
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
            console.log(`🏢 Company detected: ${companyId}. Fetching all colleague IDs...`);

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

            console.log(`✅ Found ${allIdsInCompany.length} identities in company ${companyId}`);
            return allIdsInCompany;
        }

        // 4. INDIVIDUALS - Only see their own data
        return [userId];

    } catch (error) {
        console.error('❌ [DATA ISOLATION] Error:', error);
        return [userId]; // Fallback to self-only
    }
}
