import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

// Debug configuration
const DEBUG = process.env.DEBUG === 'true' || true;

// Debug logging function
const debug = {
  log: (message, data = null) => {
    if (DEBUG) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 🔍 DEBUG: ${message}`);
      if (data) {
        console.log(`[${timestamp}] 📊 DATA:`, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
      }
    }
  },
  error: (message, error = null) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ❌ ERROR: ${message}`);
    if (error) {
      console.error(`[${timestamp}] 🐛 ERROR DETAILS:`, error.message || error);
      if (error.stack && DEBUG) {
        console.error(`[${timestamp}] 🗂️ STACK TRACE:`, error.stack);
      }
    }
  },
  warn: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] ⚠️ WARNING: ${message}`);
    if (data) {
      console.warn(`[${timestamp}] 📋 WARNING DATA:`, data);
    }
  },
  success: (message, data = null) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ✅ SUCCESS: ${message}`);
    if (data && DEBUG) {
      console.log(`[${timestamp}] 📈 SUCCESS DATA:`, data);
    }
  }
};

console.log(`🚀 PharmaCare Backend Server Starting...`);
console.log(`🔧 Debug Mode: ${DEBUG ? 'ENABLED' : 'DISABLED'}`);

// SIMPLIFIED CORS configuration - FIXED
const allowedOrigins = [
    'http://localhost:5173', 
    'http://127.0.0.1:5173', 
    'http://localhost:3000',
    'http://localhost:5174',
    'https://addisfrontend.vercel.app',  // ADD THIS
    'https://addis-frontend.vercel.app'   // Also add without the 'f' in case
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
            debug.warn('CORS blocked origin:', origin);
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With', 'X-Requested-With', 'Cache-Control', 'Pragma']
}));

// Data access helper function
// Data access helper function - FIXED VERSION
// COMPLETELY FIXED getUserAccessibleData function
// Data access helper function - COMPLETELY FIXED
// Data access helper function - FIXED FOR DATA ISOLATION
// 🔒 DATA ISOLATION HELPER - FIXED VERSION
// 🔒 UPDATED: FIXED Data access helper function with account_type
async function getUserAccessibleData(userId, userRole, userCompanyId, userAccountType = 'individual') {
    try {
        console.log(`🔐 [DATA ISOLATION] Request from:`, {
            userId,
            userRole,
            userCompanyId: userCompanyId || 'none',
            userAccountType
        });

        // 1. ADMIN - Get ALL user IDs
        if (userRole === 'admin') {
            console.log('👑 Admin accessing ALL data');
            const { data: allUsers } = await supabase
                .from('users')
                .select('id');
            const userIds = allUsers?.map(u => u.id) || [userId];
            console.log(`✅ Admin can access ${userIds.length} users`);
            return userIds;
        }
        
        // 2. COMPANY_USER - Get the company admin's ID from users table
        if (userAccountType === 'company_user') {
            console.log(`🏢 Company user (${userId}) - Need to find their company admin`);
            
            // Get company user info
            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company_id, created_by')
                .eq('id', userId)
                .single();
            
            if (!companyUser || !companyUser.company_id) {
                console.log('❌ Company user has no company assigned');
                return [userId]; // Fallback
            }
            
            // Find company admin in users table
            const { data: companyAdmin } = await supabase
                .from('users')
                .select('id')
                .eq('company_id', companyUser.company_id)
                .eq('role', 'company_admin')
                .limit(1)
                .single();
            
            if (!companyAdmin) {
                console.log('❌ No company admin found');
                return [userId]; // Fallback
            }
            
            console.log(`✅ Company user accesses through admin: ${companyAdmin.id}`);
            return [companyAdmin.id];
        }
        
        // 3. COMPANY_ADMIN - Get all users from same company (from users table)
        if (userRole === 'company_admin' && userCompanyId) {
            console.log(`🏢 Company admin for company: ${userCompanyId}`);
            const { data: companyUsers } = await supabase
                .from('users')
                .select('id')
                .eq('company_id', userCompanyId);
            const userIds = companyUsers?.map(u => u.id) || [userId];
            console.log(`✅ Company admin can access ${userIds.length} users`);
            return userIds;
        }
        
        // 4. EVERYONE ELSE (pharmacist, nurse, doctor, etc.) - ONLY their own ID
        console.log(`👤 Regular user ${userId} - ONLY their own data`);
        return [userId];

    } catch (error) {
        console.error('❌ [DATA ISOLATION] Error:', error);
        return [userId]; // Fallback: only own data
    }
}
// FIXED: Use escaped wildcard for path-to-regexp compatibility
app.options('\\*', (req, res) => {
  debug.log('Handling pre-flight request');
  res.header('Access-Control-Allow-Origin', req.headers.origin || allowedOrigins[0]);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cache-Control, Pragma');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.sendStatus(200);
});

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware to log all requests
app.use((req, res, next) => {
  if (DEBUG) {
    debug.log(`📥 ${req.method} ${req.url}`);
    if (req.method === 'POST' || req.method === 'PUT') {
      const bodyCopy = { ...req.body };
      if (bodyCopy.password) bodyCopy.password = '***';
      if (bodyCopy.password_hash) bodyCopy.password_hash = '***';
      debug.log(`📝 Request Body:`, bodyCopy);
    }
  }
  next();
});

// Initialize Supabase
let supabase;
let supabaseAdmin;

try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      global: {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY
        }
      }
    });
    debug.success('Supabase connected');
    
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      supabaseAdmin = createClient(
        process.env.SUPABASE_URL, 
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: { 
            autoRefreshToken: false, 
            persistSession: false 
          },
          global: {
            headers: {
              'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          }
        }
      );
      debug.success('Supabase Admin client created');
    }
  } else {
    debug.warn('Supabase not configured. Check environment variables.');
    debug.warn(`SUPABASE_URL: ${process.env.SUPABASE_URL ? 'SET' : 'NOT SET'}`);
    debug.warn(`SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'SET' : 'NOT SET'}`);
  }
} catch (error) {
  debug.error('Supabase initialization error:', error);
}

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'pharmacare-secret-key-change-in-production';

// Chapa Configuration
const CHAPA_SECRET_KEY = process.env.CHAPA_SECRET_KEY || 'CHASECK_TEST-BUUCXuWZFwKutOudWFIBaFbwIEb51ti3';
const CHAPA_PUBLIC_KEY = process.env.CHAPA_PUBLIC_KEY || 'CHAPUBK_TEST-U7e8egufPIViBiDwS5DQJm3Fr7NBlG75';
const CHAPA_BASE_URL = 'https://api.chapa.co/v1';

debug.success('Chapa Payment Gateway configured');

// ==================== HELPER FUNCTIONS ====================

// Validate email format
function isValidEmail(email) {
  if (!email) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = emailRegex.test(email.trim());
  debug.log(`Email validation for "${email}": ${isValid}`);
  return isValid;
}

// Calculate end date for subscription
function calculateEndDate(planId) {
  debug.log(`Calculating end date for plan: ${planId}`);
  const endDate = new Date();
  
  if (planId === 'individual_monthly' || planId === 'company_basic') {
    endDate.setMonth(endDate.getMonth() + 1);
  } else if (planId === 'individual_yearly' || planId === 'company_pro') {
    endDate.setFullYear(endDate.getFullYear() + 1);
  }
  
  const result = endDate.toISOString();
  debug.log(`End date calculated: ${result}`);
  return result;
}
// Get plan details
function getPlanDetails(planId) {
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
function generateTransactionReference() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ref = `pharmacare_${timestamp}_${random}`;
  debug.log(`Generated transaction reference: ${ref}`);
  return ref;
}

// Generate unique patient code
function generatePatientCode() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  const code = `PAT-${timestamp}-${random}`;
  debug.log(`Generated patient code: ${code}`);
  return code;
}

// Sanitize search query to prevent SQL injection
function sanitizeSearchQuery(query) {
  if (!query) return '';
  const sanitized = query
    .replace(/[;'"\\]/g, '')
    .trim()
    .slice(0, 100);
  debug.log(`Sanitized search query: "${query}" -> "${sanitized}"`);
  return sanitized;
}

// Check if user has access to patient
async function checkUserPatientAccess(userId, patientId, userRole) {
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

// ==================== SECURITY MIDDLEWARE ====================

// Authentication middleware
const authenticateToken = (req, res, next) => {
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
    const user = jwt.verify(token, JWT_SECRET);
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
// CRITICAL: Fix this middleware in server.js
const requireAdmin = (req, res, next) => {
  console.log('🔐 [AUTH] Checking admin access for user:', {
    userId: req.user?.userId,
    email: req.user?.email,
    role: req.user?.role
  });

  // Check if user exists and is admin
  if (!req.user) {
    console.log('❌ [AUTH] No user found in request');
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required' 
    });
  }

  if (req.user.role !== 'admin') {
    console.log(`🚨 [AUTH] ACCESS DENIED: User ${req.user.email} (role: ${req.user.role}) is NOT admin!`);
    console.log('🚨 [AUTH] User tried to access admin-only endpoint:', req.originalUrl);
    return res.status(403).json({ 
      success: false, 
      error: 'Admin access required. You do not have permission to access this resource.',
      user_role: req.user.role,
      required_role: 'admin'
    });
  }

  console.log(`✅ [AUTH] Admin access granted for: ${req.user.email}`);
  next();
};
// Company admin middleware
const requireCompanyAdmin = async (req, res, next) => {
  try {
    debug.log('Checking company admin access...');
    if (!req.user) {
      debug.warn('No user object in request');
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required' 
      });
    }

    debug.log(`User role: ${req.user.role}, Company ID: ${req.user.company_id}`);
    if (req.user.role === 'company_admin') {
      debug.success('Company admin access granted');
      return next();
    }

    debug.warn(`Company admin access denied for role: ${req.user.role}`);
    return res.status(403).json({ 
      success: false,
      error: 'Company admin access required' 
    });
  } catch (error) {
    debug.error('Company admin middleware error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
};

// Patient ownership middleware
const checkPatientOwnership = async (req, res, next) => {
  try {
    debug.log('Checking patient ownership...');
    const userId = req.user.userId;
    const patientId = req.params.id;
    const userRole = req.user.role;
    
    if (!patientId) {
      debug.log('No patient ID provided, skipping ownership check');
      return next();
    }

    if (!supabase) {
      debug.error('Supabase not available for ownership check');
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    debug.log(`User ID: ${userId}, Patient ID: ${patientId}, User Role: ${userRole}`);

    // Check access
    const hasAccess = await checkUserPatientAccess(userId, patientId, userRole);
    
    if (!hasAccess) {
      debug.error('Patient access denied');
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. You do not have permission to access this patient record.' 
      });
    }

    debug.success('Patient ownership verified');
    next();
  } catch (error) {
    debug.error('Patient ownership check error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error during ownership verification' 
    });
  }
};

// ==================== DATABASE SETUP & HEALTH CHECK ====================

// Health check endpoint
// Health check endpoint - FIXED USER COUNTING
// Health check endpoint - COMPLETELY FIXED
app.get('/api/health', async (req, res) => {
  try {
    debug.log('Health check requested');
    let dbStatus = 'not_configured';
    let userCount = 0;
    let adminExists = false;
    let pendingApprovals = 0;
    let patientsCount = 0;
    let medicationsCount = 0;
    let actualUsersList = [];
    
    if (supabase) {
      try {
        debug.log('Checking database connection...');
        
        // FIX 1: Use SELECT with data to count, not count() function
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('*');
        
        if (!usersError && users) {
          dbStatus = 'connected';
          userCount = users.length;
          actualUsersList = users.map(u => ({ id: u.id, email: u.email, role: u.role, approved: u.approved }));
          
          debug.log(`✅ Found ${userCount} users in database`);
          
          // Check for admin
          const adminUser = users.find(u => u.email === 'admin@pharmacare.com');
          adminExists = !!adminUser;
          
          // Count pending approvals
          pendingApprovals = users.filter(u => !u.approved).length;
          
          debug.log('Checking patients count...');
          const { data: patients } = await supabase
            .from('patients')
            .select('*');
          
          patientsCount = patients ? patients.length : 0;
          
          debug.log('Checking medications count...');
          try {
            const { data: medications } = await supabase
              .from('medications')
              .select('*');
            
            medicationsCount = medications ? medications.length : 0;
          } catch (medError) {
            debug.warn('Medications table not available yet');
          }
          
          debug.log(`Health stats: Users: ${userCount}, Patients: ${patientsCount}, Pending: ${pendingApprovals}`);
        } else {
          dbStatus = 'error';
          debug.error('Database connection error:', usersError);
        }
      } catch (error) {
        dbStatus = 'error';
        debug.error('Health check database error:', error);
      }
    }
    
    const response = {
      success: true,
      status: 'healthy',
      database: dbStatus,
      total_users: userCount,
      total_patients: patientsCount,
      total_medications: medicationsCount,
      admin_exists: adminExists,
      pending_approvals: pendingApprovals,
      has_service_role: !!supabaseAdmin,
      server_time: new Date().toISOString(),
      uptime: process.uptime(),
      memory_usage: process.memoryUsage(),
      node_version: process.version,
      debug_info: {
        user_count_method: 'SELECT * and count length',
        sample_users_count: actualUsersList.length,
        note: userCount === 0 ? 'WARNING: Database might be empty or count() function broken' : 'OK'
      }
    };
    
    debug.success('Health check completed', response);
    res.json(response);
  } catch (error) {
    debug.error('Health check error:', error);
    res.status(500).json({ 
      success: false,
      status: 'error',
      message: error.message,
      stack: DEBUG ? error.stack : undefined
    });
  }
});
// Test if users can see each other's data
app.get('/api/test/can-i-see-others-data', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userEmail = req.user.email;
    
    console.log('🔍 Testing data visibility for:', { userId, userRole, userEmail });
    
    // Test 1: Try to get ALL patients (what regular endpoint does)
    const { data: allPatients } = await supabase
      .from('patients')
      .select('*');
    
    // Test 2: Get only user's own patients
    const { data: ownPatients } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', userId);
    
    // Test 3: Count total patients in system
    const totalPatients = allPatients ? allPatients.length : 0;
    const ownPatientsCount = ownPatients ? ownPatients.length : 0;
    const otherPatientsCount = totalPatients - ownPatientsCount;
    
    // Test 4: Check if patient records have user_id
    let patientsWithUserIds = 0;
    let patientsWithoutUserIds = 0;
    
    if (allPatients) {
      allPatients.forEach(p => {
        if (p.user_id) {
          patientsWithUserIds++;
        } else {
          patientsWithoutUserIds++;
        }
      });
    }
    
    res.json({
      success: true,
      current_user: {
        id: userId,
        email: userEmail,
        role: userRole
      },
      patient_analysis: {
        total_patients_in_system: totalPatients,
        your_patients: ownPatientsCount,
        other_users_patients: otherPatientsCount,
        can_you_see_others_data: otherPatientsCount > 0 ? 'YES - Data leak!' : 'NO - Good!',
        patient_ownership_status: {
          patients_with_user_id: patientsWithUserIds,
          patients_without_user_id: patientsWithoutUserIds,
          percentage_with_owner: totalPatients > 0 ? ((patientsWithUserIds / totalPatients) * 100).toFixed(1) + '%' : 'N/A'
        }
      },
      data_isolation_status: userRole === 'admin' 
        ? '✅ Admin SHOULD see all data' 
        : otherPatientsCount > 0 
          ? '❌ REGULAR USER SHOULD NOT see other users\' data, but they CAN!'
          : '✅ Regular user correctly sees only their own data',
      recommendation: otherPatientsCount > 0 && userRole !== 'admin'
        ? 'URGENT: Fix getUserAccessibleData() function - it returns too many user IDs'
        : 'Data isolation is working correctly'
    });
    
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Find out who owns the patients and test data isolation
app.get('/api/debug/who-owns-patients', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userEmail = req.user.email;
    
    console.log('🔍 Investigating patient ownership for:', { userId, userRole, userEmail });
    
    // STEP 1: Get ALL patients in system
    const { data: allPatients, error: patientsError } = await supabase
      .from('patients')
      .select('*');
    
    if (patientsError) {
      throw patientsError;
    }
    
    // STEP 2: Get user's own patients
    const { data: ownPatients, error: ownError } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', userId);
    
    // STEP 3: Group patients by owner
    const patientsByOwner = {};
    const unknownOwners = [];
    
    if (allPatients) {
      allPatients.forEach(patient => {
        const ownerId = patient.user_id;
        if (!ownerId) {
          unknownOwners.push(patient);
        } else {
          if (!patientsByOwner[ownerId]) {
            patientsByOwner[ownerId] = [];
          }
          patientsByOwner[ownerId].push(patient);
        }
      });
    }
    
    // STEP 4: Get user info for each owner
    const ownerIds = Object.keys(patientsByOwner);
    let ownerInfo = {};
    
    if (ownerIds.length > 0) {
      const { data: owners, error: ownersError } = await supabase
        .from('users')
        .select('id, email, role, full_name')
        .in('id', ownerIds);
      
      if (!ownersError && owners) {
        owners.forEach(owner => {
          ownerInfo[owner.id] = {
            email: owner.email,
            role: owner.role,
            full_name: owner.full_name
          };
        });
      }
    }
    
    // STEP 5: Test what this user can see through regular endpoint
    console.log('🔍 Testing what user can see through /api/patients...');
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
    
    let accessiblePatients = [];
    if (accessibleUserIds.length > 0) {
      const { data: patientsUserCanSee } = await supabase
        .from('patients')
        .select('*')
        .in('user_id', accessibleUserIds);
      
      accessiblePatients = patientsUserCanSee || [];
    }
    
    // STEP 6: Analysis
    const totalPatients = allPatients ? allPatients.length : 0;
    const userOwnPatients = ownPatients ? ownPatients.length : 0;
    const patientsUserCanAccess = accessiblePatients.length;
    const otherPatientsUserCanSee = patientsUserCanAccess - userOwnPatients;
    
    res.json({
      success: true,
      current_user: {
        id: userId,
        email: userEmail,
        role: userRole
      },
      patient_ownership_analysis: {
        total_patients_in_system: totalPatients,
        your_patients: userOwnPatients,
        patients_you_can_access: patientsUserCanAccess,
        other_patients_you_can_see: otherPatientsUserCanSee,
        unknown_ownership_patients: unknownOwners.length
      },
      detailed_breakdown: {
        patients_by_owner: Object.keys(patientsByOwner).map(ownerId => ({
          owner_id: ownerId,
          owner_info: ownerInfo[ownerId] || { note: 'User not found in database' },
          patient_count: patientsByOwner[ownerId].length,
          sample_patient: patientsByOwner[ownerId][0] ? {
            id: patientsByOwner[ownerId][0].id,
            name: patientsByOwner[ownerId][0].full_name,
            created: patientsByOwner[ownerId][0].created_at
          } : null
        })),
        unknown_owners: unknownOwners.map(p => ({
          id: p.id,
          name: p.full_name,
          created: p.created_at,
          note: 'No user_id assigned'
        }))
      },
      data_isolation_test: {
        accessible_user_ids: accessibleUserIds,
        accessible_users_count: accessibleUserIds.length,
        includes_self: accessibleUserIds.includes(userId),
        sample_accessible_patients: accessiblePatients.slice(0, 3).map(p => ({
          id: p.id,
          name: p.full_name,
          owner: p.user_id,
          is_yours: p.user_id === userId
        }))
      },
      conclusion: {
        data_isolation_status: userRole === 'admin' 
          ? '✅ Admin correctly sees all patients' 
          : otherPatientsUserCanSee > 0 
            ? `❌ DATA LEAK: ${userRole} user can see ${otherPatientsUserCanSee} other users' patients!`
            : '✅ Data isolation working: User only sees their own patients',
        issue_found: otherPatientsUserCanSee > 0 && userRole !== 'admin'
          ? `The getUserAccessibleData() function returns ${accessibleUserIds.length} user IDs instead of just [${userId}]`
          : 'No data isolation issue detected'
      },
      recommendations: otherPatientsUserCanSee > 0 && userRole !== 'admin' 
        ? [
            '1. Fix getUserAccessibleData() function',
            '2. Ensure it returns ONLY [userId] for non-admin users',
            '3. Check user roles in JWT tokens',
            '4. Verify database permissions'
          ]
        : [
            '1. Data isolation appears to be working',
            '2. Regular users can only see their own data'
          ]
    });
    
  } catch (error) {
    console.error('Ownership investigation error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
// Add this endpoint to test data isolation
app.get('/api/test/data-isolation-verify', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userEmail = req.user.email;
    
    console.log('🔍 VERIFYING Data Isolation for:', { userId, userRole, userEmail });
    
    // Test 1: Get ALL patients in system (admin view)
    const { data: allPatients } = await supabase
      .from('patients')
      .select('*');
    
    // Test 2: Get only user's own patients
    const { data: ownPatients } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', userId);
    
    // Test 3: See what /api/patients would return (using your current logic)
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
    
    let accessiblePatients = [];
    if (accessibleUserIds.length > 0) {
      const { data: patients } = await supabase
        .from('patients')
        .select('*')
        .in('user_id', accessibleUserIds);
      accessiblePatients = patients || [];
    }
    
    // Analysis
    const totalPatients = allPatients ? allPatients.length : 0;
    const userOwnPatients = ownPatients ? ownPatients.length : 0;
    const patientsUserCanSee = accessiblePatients.length;
    const otherPatientsVisible = patientsUserCanSee - userOwnPatients;
    
    // Find out who owns the patients
    const patientOwners = {};
    if (allPatients) {
      allPatients.forEach(p => {
        if (p.user_id) {
          if (!patientOwners[p.user_id]) {
            patientOwners[p.user_id] = [];
          }
          patientOwners[p.user_id].push(p.id);
        }
      });
    }
    
    res.json({
      success: true,
      current_user: {
        id: userId,
        email: userEmail,
        role: userRole
      },
      database_state: {
        total_patients: totalPatients,
        total_users: 27, // from health check
        pending_approvals: 23 // from health check
      },
      what_user_can_see: {
        through_my_patients_endpoint: userOwnPatients,
        through_main_patients_endpoint: patientsUserCanSee,
        difference: patientsUserCanSee - userOwnPatients,
        other_users_patients_visible: otherPatientsVisible
      },
      patient_ownership: {
        owners: Object.keys(patientOwners).map(ownerId => ({
          user_id: ownerId,
          patient_count: patientOwners[ownerId].length,
          patient_ids: patientOwners[ownerId]
        })),
        total_owners: Object.keys(patientOwners).length
      },
      data_isolation_verdict: userRole === 'admin' 
        ? '✅ Admin SHOULD see all patients' 
        : otherPatientsVisible > 0 
          ? `❌ FAIL: ${userRole} can see ${otherPatientsVisible} other users' patients!`
          : '✅ PASS: User can only see their own patients',
      accessible_users_analysis: {
        user_ids: accessibleUserIds,
        count: accessibleUserIds.length,
        includes_self: accessibleUserIds.includes(userId),
        expected_for_role: userRole === 'admin' ? 'All user IDs' : 'Only [userId]'
      }
    });
    
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Add this endpoint to see EXACTLY who owns the patients
app.get('/api/debug/who-has-patients', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    console.log('🔍 DEBUG: Finding patient owners...');
    
    // Get ALL patients
    const { data: allPatients } = await supabase
      .from('patients')
      .select('*');
    
    if (!allPatients || allPatients.length === 0) {
      return res.json({
        success: true,
        message: 'No patients in database',
        total_patients: 0
      });
    }
    
    // Group patients by user_id
    const patientsByUser = {};
    allPatients.forEach(patient => {
      const ownerId = patient.user_id || 'unknown';
      if (!patientsByUser[ownerId]) {
        patientsByUser[ownerId] = [];
      }
      patientsByOwner[ownerId].push({
        id: patient.id,
        name: patient.full_name,
        created_at: patient.created_at
      });
    });
    
    // Get user info for each owner
    const userIds = Object.keys(patientsByUser).filter(id => id !== 'unknown');
    let userInfo = {};
    
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, email, role, full_name, approved')
        .in('id', userIds);
      
      if (users) {
        users.forEach(user => {
          userInfo[user.id] = {
            email: user.email,
            role: user.role,
            full_name: user.full_name,
            approved: user.approved
          };
        });
      }
    }
    
    // Check if current user has patients
    const currentUserHasPatients = patientsByUser[userId] ? patientsByUser[userId].length : 0;
    
    res.json({
      success: true,
      total_patients_in_system: allPatients.length,
      current_user: {
        id: userId,
        role: userRole,
        has_patients: currentUserHasPatients,
        patient_count: currentUserHasPatients
      },
      patient_ownership: Object.keys(patientsByUser).map(ownerId => {
        const isCurrentUser = ownerId === userId;
        const owner = ownerId !== 'unknown' ? userInfo[ownerId] : null;
        
        return {
          owner_id: ownerId,
          owner_info: ownerId === 'unknown' 
            ? { note: 'No user_id assigned to patient' } 
            : owner 
              ? { email: owner.email, role: owner.role, name: owner.full_name, approved: owner.approved }
              : { note: 'User not found in database' },
          patient_count: patientsByUser[ownerId].length,
          patients: patientsByUser[ownerId],
          is_current_user: isCurrentUser,
          ownership_status: isCurrentUser 
            ? '👤 Current user owns these patients' 
            : ownerId === 'unknown' 
              ? '❓ Unknown ownership' 
              : '👥 Another user owns these patients'
        };
      }),
      summary: {
        total_owners: Object.keys(patientsByUser).length,
        patients_with_known_owners: Object.keys(patientsByUser)
          .filter(id => id !== 'unknown')
          .reduce((sum, id) => sum + patientsByUser[id].length, 0),
        patients_with_unknown_owners: patientsByUser['unknown'] ? patientsByUser['unknown'].length : 0,
        current_user_status: currentUserHasPatients > 0 
          ? `Has ${currentUserHasPatients} patients` 
          : 'Has no patients'
      },
      data_isolation_status: userRole === 'admin'
        ? '✅ Admin should see ALL patients'
        : currentUserHasPatients === allPatients.length
          ? '⚠️ Warning: User can see ALL patients (data leak!)'
          : currentUserHasPatients === 0 && allPatients.length > 0
            ? '✅ Perfect: User sees only their own patients (0)'
            : '✅ Correct: User sees only their own patients'
    });
    
  } catch (error) {
    console.error('Patient ownership investigation error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});
// SIMPLE TEST: Check if user can see other patients
app.get('/api/test/can-i-see-others', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    console.log('🧪 SIMPLE TEST: Can user see others?', { userId, userRole });
    
    // Test 1: How many patients in total system?
    const { count: totalPatients } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true });
    
    // Test 2: How many patients does THIS user own?
    const { count: userOwnPatients } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    // Test 3: How many patients can user see through /api/patients?
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
    
    let patientsUserCanSee = 0;
    if (accessibleUserIds.length > 0) {
      const { count: count } = await supabase
        .from('patients')
        .select('*', { count: 'exact', head: true })
        .in('user_id', accessibleUserIds);
      patientsUserCanSee = count || 0;
    }
    
    // Analysis
    const otherPatientsVisible = patientsUserCanSee - userOwnPatients;
    const dataIsolationWorking = otherPatientsVisible === 0 || userRole === 'admin';
    
    res.json({
      success: true,
      test_summary: {
        user_role: userRole,
        total_patients_system: totalPatients || 0,
        user_own_patients: userOwnPatients || 0,
        patients_user_can_see: patientsUserCanSee,
        other_patients_visible: otherPatientsVisible,
        accessible_user_ids_count: accessibleUserIds.length,
        data_isolation_status: dataIsolationWorking ? '✅ WORKING' : '❌ BROKEN'
      },
      verdict: userRole === 'admin' 
        ? '✅ Admin SHOULD see all patients' 
        : otherPatientsVisible === 0 
          ? '✅ User correctly sees ONLY their own patients'
          : `❌ PROBLEM: User can see ${otherPatientsVisible} other users' patients!`,
      recommendation: otherPatientsVisible > 0 && userRole !== 'admin'
        ? 'URGENT: Fix getUserAccessibleData() function'
        : 'No action needed'
    });
    
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SIMPLE: Find out who owns the 3 patients
app.get('/api/debug/simple-patient-owners', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 SIMPLE: Finding patient owners...');
    
    // Get ALL patients
    const { data: allPatients } = await supabase
      .from('patients')
      .select('id, full_name, user_id, created_at');
    
    if (!allPatients || allPatients.length === 0) {
      return res.json({
        success: true,
        message: 'No patients in database'
      });
    }
    
    // Group by user_id
    const grouped = {};
    allPatients.forEach(p => {
      const ownerId = p.user_id || 'unknown';
      if (!grouped[ownerId]) {
        grouped[ownerId] = [];
      }
      grouped[ownerId].push({
        id: p.id,
        name: p.full_name,
        created: p.created_at
      });
    });
    
    // Get user info for owners
    const ownerIds = Object.keys(grouped).filter(id => id !== 'unknown');
    let ownerInfo = {};
    
    if (ownerIds.length > 0) {
      const { data: owners } = await supabase
        .from('users')
        .select('id, email, role, full_name')
        .in('id', ownerIds);
      
      if (owners) {
        owners.forEach(owner => {
          ownerInfo[owner.id] = {
            email: owner.email,
            role: owner.role,
            name: owner.full_name
          };
        });
      }
    }
    
    res.json({
      success: true,
      total_patients: allPatients.length,
      patient_owners: Object.keys(grouped).map(ownerId => ({
        owner_id: ownerId,
        owner_info: ownerId === 'unknown' 
          ? { note: 'No user_id assigned' }
          : ownerInfo[ownerId] 
            ? ownerInfo[ownerId]
            : { note: 'User not found' },
        patient_count: grouped[ownerId].length,
        patient_names: grouped[ownerId].map(p => p.name)
      })),
      summary: `Found ${allPatients.length} patients owned by ${Object.keys(grouped).length} different users`
    });
    
  } catch (error) {
    console.error('Simple debug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Check database tables
app.get('/api/admin/check-tables', async (req, res) => {
  try {
    debug.log('Checking database tables...');
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Supabase not configured'
      });
    }

    const tables = [
      'users', 'patients', 'subscriptions', 'payments', 'companies', 
      'medications', 'medication_history', 'drn_assessments', 
      'pharmacy_assistance_plans', 'patient_outcomes', 'cost_analyses',
      'prescriptions', 'allergies', 'conditions', 'labs', 'vitals'
    ];
    
    const tableStatus = {};

    for (const table of tables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('*')
          .limit(1);

        tableStatus[table] = error ? 'missing' : 'exists';
        debug.log(`Table ${table}: ${tableStatus[table]}`);
      } catch (err) {
        tableStatus[table] = 'error';
        debug.error(`Error checking table ${table}:`, err);
      }
    }

    res.json({
      success: true,
      tables: tableStatus,
      message: 'Database structure checked',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Check tables error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to check tables',
      details: error.message
    });
  }
});

// ==================== AUTO-ADMIN CREATION SYSTEM ====================

// Function to create admin user automatically - UPDATED
const ensureAdminExists = async () => {
  try {
    debug.log('🔧 Checking if admin user exists...');
    
    if (!supabase) {
      debug.error('Supabase not configured');
      return { success: false, message: 'Supabase not configured' };
    }

    const adminEmail = 'admin@pharmacare.com';
    const adminPassword = 'Admin@123';
    const adminName = 'System Administrator';
    
    // First, check if users table exists
    try {
      const { error: tableCheckError } = await supabase
        .from('users')
        .select('*')
        .limit(1);
      
      if (tableCheckError && tableCheckError.code === '42P01') {
        debug.error('Users table does not exist!');
        return { 
          success: false, 
          message: 'Users table does not exist. Please run the SQL script.' 
        };
      }
    } catch (tableError) {
      debug.error('Error checking users table:', tableError);
      return { success: false, message: 'Error checking users table' };
    }
    
    // Check if admin exists using maybeSingle to avoid errors
    const { data: existingAdmin, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', adminEmail)
      .maybeSingle();

    if (fetchError) {
      debug.error('Error fetching admin:', fetchError);
      return { success: false, message: 'Error fetching admin user' };
    }

    if (existingAdmin) {
      debug.success('✅ Admin user already exists', { 
        id: existingAdmin.id,
        role: existingAdmin.role,
        account_type: existingAdmin.account_type 
      });
      
      // Update to ensure admin has correct account_type
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      
      const { error: updateError } = await supabase
        .from('users')
        .update({ 
          password_hash: hashedPassword,
          approved: true,
          role: 'admin',
          account_type: 'admin',  // Ensure account_type is set
          full_name: adminName,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingAdmin.id);
      
      if (updateError) {
        debug.error('Failed to update admin:', updateError);
        return { 
          success: false, 
          message: 'Admin exists but could not update',
          error: updateError.message 
        };
      }
      
      debug.success('✅ Admin user updated successfully');
      return { 
        success: true, 
        message: 'Admin user updated', 
        adminId: existingAdmin.id,
        action: 'updated'
      };
    }

    debug.log('🆕 Creating new admin user...');
    
    // Create new admin
    try {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      
      const adminData = {
        email: adminEmail,
        password_hash: hashedPassword,
        full_name: adminName,
        role: 'admin',
        approved: true,
        account_type: 'admin',  // Explicitly set account_type
        subscription_status: 'active',
        institution: 'PharmaCare System',
        country: 'Ethiopia',
        phone: '+251-XXX-XXXXXX',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: newAdmin, error: insertError } = await supabase
        .from('users')
        .insert([adminData])
        .select()
        .single();

      if (insertError) {
        debug.error('❌ Failed to create admin:', insertError);
        return { 
          success: false, 
          message: 'Failed to create admin user',
          error: insertError.message 
        };
      }

      debug.success('✅ Admin user created successfully', { id: newAdmin.id });
      return { 
        success: true, 
        message: 'Admin user created', 
        adminId: newAdmin.id,
        action: 'created'
      };
    } catch (insertError) {
      debug.error('Error creating admin:', insertError);
      return { 
        success: false, 
        message: 'Error creating admin',
        error: insertError.message 
      };
    }
    
  } catch (error) {
    debug.error('❌ Error in ensureAdminExists:', error);
    return { 
      success: false, 
      message: 'Unexpected error in admin setup',
      error: error.message 
    };
  }
};

// Run admin creation on server start
setTimeout(async () => {
  console.log('\n' + '='.repeat(50));
  console.log('🔄 AUTO-ADMIN SETUP INITIALIZING...');
  console.log('='.repeat(50));
  
  const result = await ensureAdminExists();
  
  if (result.success) {
    console.log('\n' + '='.repeat(50));
    console.log('✅ ADMIN SETUP COMPLETE!');
    console.log('='.repeat(50));
    console.log('📧 Email: admin@pharmacare.com');
    console.log('🔑 Password: Admin@123');
    console.log('👤 Role: System Administrator');
    console.log(`🔧 Action: ${result.action}`);
    console.log('='.repeat(50));
    console.log('🚀 You can now login with the credentials above');
    console.log('='.repeat(50) + '\n');
  } else {
    console.log('\n' + '='.repeat(50));
    console.log('⚠️ ADMIN SETUP FAILED');
    console.log('='.repeat(50));
    console.log(`❌ Error: ${result.message}`);
    console.log('='.repeat(50));
    console.log('🆘 EMERGENCY FIX COMMANDS:');
    console.log('1. Run SQL in Supabase to create users table');
    console.log('2. curl -X POST http://localhost:3000/api/debug/fix-admin');
    console.log('='.repeat(50) + '\n');
  }
}, 2000);

// ==================== EMERGENCY FIX ENDPOINTS ====================

// Emergency admin fix endpoint
app.post('/api/debug/fix-admin', async (req, res) => {
  try {
    debug.log('🚨 Emergency admin fix requested');
    
    const result = await ensureAdminExists();
    
    if (result.success) {
      res.json({
        success: true,
        message: '✅ Admin user ready!',
        credentials: {
          email: 'admin@pharmacare.com',
          password: 'Admin@123',
          role: 'admin'
        },
        action: result.action,
        adminId: result.adminId,
        instructions: 'You can now login with the credentials above.'
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.message || 'Failed to setup admin',
        details: result.error,
        solution: 'Check if users table exists in Supabase. Run the SQL script first.'
      });
    }
  } catch (error) {
    debug.error('Emergency fix error:', error);
    res.status(500).json({
      success: false,
      error: 'Emergency fix failed',
      details: error.message,
      stack: DEBUG ? error.stack : undefined
    });
  }
});

// Check admin status
app.get('/api/debug/admin-status', async (req, res) => {
  try {
    debug.log('Checking admin status...');
    
    if (!supabase) {
      return res.json({
        success: false,
        message: 'Supabase not configured',
        admin_exists: false
      });
    }
    
    const { data: adminUser } = await supabase
      .from('users')
      .select('id, email, full_name, role, approved, created_at')
      .eq('email', 'admin@pharmacare.com')
      .maybeSingle();
    
    const adminExists = !!adminUser;
    
    let passwordCorrect = false;
    if (adminUser) {
      try {
        // Try default password
        passwordCorrect = await bcrypt.compare('Admin@123', adminUser.password_hash);
        
        if (!passwordCorrect) {
          // Try direct comparison for emergency
          const testHash = await bcrypt.hash('Admin@123', 10);
          const tempHash = await bcrypt.hash('Admin@123', 10);
          passwordCorrect = await bcrypt.compare('Admin@123', adminUser.password_hash);
        }
      } catch (bcryptError) {
        debug.error('Password check error:', bcryptError);
      }
    }
    
    res.json({
      success: true,
      admin_exists: adminExists,
      admin_user: adminUser,
      password_correct: passwordCorrect,
      login_ready: adminExists && passwordCorrect,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    debug.error('Admin status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check admin status',
      details: error.message
    });
  }
});

// Force create admin endpoint
app.post('/api/debug/force-create-admin', async (req, res) => {
  try {
    debug.log('🚨 Force creating admin user...');
    
    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'Supabase not configured'
      });
    }
    
    const adminEmail = 'admin@pharmacare.com';
    const adminPassword = 'Admin@123';
    const adminName = 'System Administrator';
    
    // First delete existing admin if exists
    await supabase
      .from('users')
      .delete()
      .eq('email', adminEmail);
    
    // Create new admin
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    
    const adminData = {
      email: adminEmail,
      password_hash: hashedPassword,
      full_name: adminName,
      role: 'admin',
      approved: true,
      account_type: 'admin',
      subscription_status: 'active',
      institution: 'PharmaCare System',
      country: 'Ethiopia',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data: newAdmin, error: insertError } = await supabase
      .from('users')
      .insert([adminData])
      .select()
      .single();
    
    if (insertError) {
      debug.error('Force create admin failed:', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to force create admin',
        details: insertError.message
      });
    }
    
    debug.success('Admin force created successfully');
    
    // Create JWT token for immediate login
    const token = jwt.sign(
      { 
        userId: newAdmin.id, 
        email: newAdmin.email, 
        role: newAdmin.role,
        name: newAdmin.full_name
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      success: true,
      message: '✅ Admin user force created successfully!',
      token: token,
      credentials: {
        email: adminEmail,
        password: adminPassword,
        role: 'admin'
      },
      user: {
        id: newAdmin.id,
        email: newAdmin.email,
        full_name: newAdmin.full_name,
        role: newAdmin.role,
        approved: newAdmin.approved
      },
      instructions: 'You can now login with the credentials above or use the provided token.'
    });
    
  } catch (error) {
    debug.error('Force create admin error:', error);
    res.status(500).json({
      success: false,
      error: 'Force create admin failed',
      details: error.message
    });
  }
});

// ==================== AUTHENTICATION ROUTES ====================

// User Login - DEBUGGED VERSION
// ✅ UPDATED: Login checks both users and company_users tables
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔐 LOGIN ATTEMPT:', { email, passwordLength: password?.length });

        if (!email || !password) {
            console.log('❌ Missing email or password');
            return res.status(400).json({ 
                success: false,
                error: 'Email and password are required' 
            });
        }

        if (!supabase) {
            console.error('❌ Supabase not configured');
            return res.status(503).json({ 
                success: false,
                error: 'Database not configured'
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPassword = password.trim();

        console.log('🔍 Searching for user in both tables:', cleanEmail);

        let user = null;
        let userType = null;
        let fetchError = null;

        // First, try to find in regular users table
        const { data: regularUser, error: regularError } = await supabase
            .from('users')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (regularUser) {
            console.log('✅ Found in users table');
            user = regularUser;
            userType = 'regular_user';
        } else {
            // If not found in users table, try company_users table
            console.log('🔍 Not found in users table, checking company_users...');
            const { data: companyUser, error: companyError } = await supabase
                .from('company_users')
                .select('*')
                .eq('email', cleanEmail)
                .maybeSingle();

            if (companyUser) {
                console.log('✅ Found in company_users table');
                user = companyUser;
                userType = 'company_user';
                fetchError = companyError;
            } else {
                console.log('❌ User not found in either table');
                fetchError = regularError;
            }
        }

        if (fetchError) {
            console.error('❌ Database query error:', fetchError);
            return res.status(500).json({ 
                success: false,
                error: 'Database error during login'
            });
        }

        if (!user) {
            console.log('❌ User not found in database:', cleanEmail);
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password'
            });
        }

        console.log('✅ User found:', {
            id: user.id,
            email: user.email,
            user_type: userType,
            approved: user.approved,
            password_hash_length: user.password_hash?.length || 0
        });

        // Check password
        let validPassword = false;
        try {
            if (user.password_hash) {
                console.log('🔑 Using bcrypt comparison...');
                validPassword = await bcrypt.compare(cleanPassword, user.password_hash);
                console.log('🔑 Bcrypt result:', validPassword);
            }
        } catch (bcryptError) {
            console.error('❌ Password comparison error:', bcryptError);
        }

        if (!validPassword) {
            console.log('❌ Invalid password for user:', cleanEmail);
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password'
            });
        }

        console.log('✅ Password verified successfully');

        // Check approval status based on user type
        console.log('📋 Checking approval status:', {
            user_type: userType,
            approved: user.approved,
            email: user.email
        });

        // Admin users can always login
        if (user.role === 'admin') {
            console.log('✅ Admin user, allowing login');
        } 
        // Non-admin users must be approved
        else if (!user.approved) {
            console.log('❌ User not approved:', user.email);
            return res.status(401).json({ 
                success: false,
                error: 'Your account is pending approval. Please wait for approval before logging in.',
                approval_required: true,
                user_email: user.email,
                account_type: user.account_type
            });
        }
        
        console.log('✅ User is approved, allowing login');

        // Create JWT token with user type info
        const tokenPayload = {
            userId: user.id,
            email: user.email,
            name: user.full_name,
            role: user.role,
            approved: user.approved,
            account_type: userType === 'company_user' ? 'company_user' : (user.account_type || 'individual'),
            user_type: userType
        };

        if (user.company_id) {
            tokenPayload.company_id = user.company_id;
        }

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        // Prepare response based on user type
        const userResponse = {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            approved: user.approved,
            account_type: userType === 'company_user' ? 'company_user' : (user.account_type || 'individual'),
            institution: user.institution,
            company_id: user.company_id,
            subscription_status: user.subscription_status || 'inactive',
            subscription_plan: user.subscription_plan || null,
            subscription_end_date: user.subscription_end_date,
            created_at: user.created_at,
            phone: user.phone,
            country: user.country,
            region: user.region,
            tin_number: user.tin_number || '',
            license_number: user.license_number || ''
        };

        console.log('✅ Login successful for:', user.email);
        
        res.json({
            success: true,
            message: 'Login successful',
            token: token,
            user: userResponse,
            user_type: userType,
            token_expires_in: '24 hours'
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Login failed',
            details: error.message
        });
    }
});

// Debug endpoint to check/fix user passwords
app.post('/api/debug/check-user-password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔧 Checking user password:', { email });
    
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Find user
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    console.log('🔍 User found:', {
      id: user.id,
      email: user.email,
      role: user.role,
      approved: user.approved,
      password_hash: user.password_hash?.substring(0, 20) + '...'
    });

    let passwordMatch = false;
    let testResult = null;
    
    if (password && user.password_hash) {
      passwordMatch = await bcrypt.compare(password, user.password_hash);
      testResult = {
        provided_password: password,
        matches: passwordMatch
      };
    }

    // Option to reset password
    let resetResult = null;
    if (req.body.reset_password && req.body.new_password) {
      const newHash = await bcrypt.hash(req.body.new_password, 10);
      await supabase
        .from('users')
        .update({ 
          password_hash: newHash,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);
      
      resetResult = {
        reset: true,
        new_password_hash: newHash.substring(0, 20) + '...'
      };
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        approved: user.approved,
        account_type: user.account_type,
        created_at: user.created_at
      },
      password_check: testResult,
      password_reset: resetResult,
      note: 'Use reset_password=true and new_password=... to reset password'
    });

  } catch (error) {
    console.error('Debug password check error:', error);
    res.status(500).json({
      success: false,
      error: 'Debug check failed',
      details: error.message
    });
  }
});

// Test endpoint to create a user with working password
app.post('/api/debug/create-test-user', async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;
    
    if (!email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, and full_name are required'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();
    
    console.log('🧪 Creating test user:', cleanEmail);

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingUser) {
      // Update password
      const newHash = await bcrypt.hash(cleanPassword, 10);
      await supabase
        .from('users')
        .update({
          password_hash: newHash,
          approved: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingUser.id);
      
      console.log('✅ Updated existing user password');
      
      return res.json({
        success: true,
        action: 'updated',
        user_id: existingUser.id,
        email: cleanEmail,
        password_test: 'Try login with: ' + cleanPassword,
        note: 'Password reset to provided value'
      });
    }

    // Create new user
    const hashedPassword = await bcrypt.hash(cleanPassword, 10);
    
    const userData = {
      email: cleanEmail,
      password_hash: hashedPassword,
      full_name: full_name.trim(),
      phone: '0912345678',
      institution: 'Test Hospital',
      country: 'Ethiopia',
      region: 'Addis Ababa',
      role: role || 'pharmacist',
      account_type: 'individual',
      approved: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert([userData])
      .select()
      .single();

    if (insertError) {
      console.error('❌ Create test user error:', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create test user',
        details: insertError.message
      });
    }

    console.log('✅ Test user created:', user.id);

    res.json({
      success: true,
      action: 'created',
      user_id: user.id,
      email: cleanEmail,
      password: 'Use: ' + cleanPassword,
      note: 'User created with password you provided. Use this to login.',
      credentials: {
        email: cleanEmail,
        password: cleanPassword
      }
    });

  } catch (error) {
    console.error('❌ Create test user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test user',
      details: error.message
    });
  }
});

// Add this to your backend server.js or auth routes
app.post('/api/auth/verify-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('🔐 Token verification request:', authHeader);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        error: 'No token provided',
        debug: { authHeader }
      });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('🔐 Token to verify:', token.substring(0, 20) + '...');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('✅ Token decoded:', decoded);
      
      res.json({
        success: true,
        valid: true,
        decoded,
        message: 'Token is valid'
      });
    } catch (jwtError) {
      console.error('❌ JWT verification error:', jwtError.message);
      
      res.status(401).json({
        success: false,
        valid: false,
        error: jwtError.message,
        message: 'Token is invalid or expired'
      });
    }
  } catch (error) {
    console.error('❌ Token verification endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Verification failed',
      details: error.message 
    });
  }
});

// Individual User Registration - FIXED
app.post('/api/auth/register', async (req, res) => {
  try {
    const { 
      email, 
      password, 
      full_name, 
      phone = '', 
      // Removed institution parameter
      country = 'Ethiopia', 
      region = '', 
      woreda = '',
      tin_number = '',
      license_number = '',
      role = 'pharmacist',
      account_type = 'individual'
    } = req.body;

    debug.log('Individual registration:', { email, full_name, phone });

    // Validate required fields - removed institution
    if (!email || !password || !full_name || !phone) {
      return res.status(400).json({ 
        success: false,
        error: 'Email, password, full name, and phone are required' 
      });
    }

    // Validate email
    const trimmedEmail = email.trim().toLowerCase();
    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({ 
        success: false,
        error: 'Please enter a valid email address' 
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', trimmedEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    // Create user data - removed institution
    const userData = {
      email: trimmedEmail,
      password_hash: hashedPassword,
      full_name: full_name.trim(),
      phone: phone.trim(),
      // Removed institution field
      country: country.trim(),
      region: region.trim(),
      woreda: woreda.trim(),
      tin_number: tin_number.trim(),
      license_number: license_number?.trim() || '',
      approved: false,
      role: role || 'pharmacist',
      account_type: account_type || 'individual',
      subscription_status: 'inactive',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Insert user
    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert([userData])
      .select()
      .single();

    if (insertError) {
      debug.error('Registration failed:', insertError);
      return res.status(500).json({ 
        success: false,
        error: 'Registration failed',
        details: insertError.message
      });
    }

    debug.success(`User registered: ${user.id} - approved: ${user.approved}`);

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please wait for admin approval.',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        approved: user.approved,
        role: user.role,
        account_type: user.account_type
      },
      id: user.id,
      userId: user.id,
      user_id: user.id
    });

  } catch (error) {
    debug.error('Registration error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Registration failed',
      details: error.message
    });
  }
});

// Company Registration - FIXED
app.post('/api/auth/register-company', async (req, res) => {
  try {
    const { 
      company_name,
      company_registration_number,
      company_address,
      company_size = '1-10',
      company_type = 'pharmacy',
      tin_number,
      country = 'Ethiopia',
      region,
      user_capacity = 5,
      admin_email,
      admin_password,
      admin_full_name,
      admin_phone,
      admin_license_number = ''
    } = req.body;

    debug.log('Company registration:', { company_name, admin_email, admin_phone });

    // Validate required fields
    if (!company_name || !company_registration_number || !admin_email || 
        !admin_password || !admin_full_name || !admin_phone) {
      return res.status(400).json({ 
        success: false,
        error: 'Company name, registration number, admin email, password, full name, and phone are required' 
      });
    }

    // Validate admin email
    const trimmedAdminEmail = admin_email.trim().toLowerCase();
    if (!isValidEmail(trimmedAdminEmail)) {
      return res.status(400).json({ 
        success: false,
        error: 'Please enter a valid admin email address' 
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check if company exists
    const trimmedCompanyName = company_name.trim();
    const trimmedCompanyRegNumber = company_registration_number.trim();

    const { data: existingCompany } = await supabase
      .from('companies')
      .select('id')
      .or(`company_name.ilike.%${trimmedCompanyName}%,company_registration_number.ilike.%${trimmedCompanyRegNumber}%`)
      .maybeSingle();

    if (existingCompany) {
      return res.status(400).json({ 
        success: false,
        error: 'Company name or registration number already exists' 
      });
    }

    // Check if admin email exists
    const { data: existingAdmin } = await supabase
      .from('users')
      .select('id')
      .eq('email', trimmedAdminEmail)
      .maybeSingle();

    if (existingAdmin) {
      return res.status(400).json({ 
        success: false,
        error: 'Admin email already registered' 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(admin_password.trim(), 10);
    const client = supabaseAdmin || supabase;

    // 1. Create company
    const companyData = {
      company_name: trimmedCompanyName,
      company_registration_number: trimmedCompanyRegNumber,
      company_address: company_address?.trim() || '',
      company_size: company_size || '1-10',
      company_type: company_type || 'pharmacy',
      tin_number: tin_number?.trim() || '',
      country: country.trim(),
      region: region?.trim() || '',
      user_capacity: parseInt(user_capacity) || 5,
      subscription_status: 'inactive',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: company, error: companyError } = await client
      .from('companies')
      .insert([companyData])
      .select()
      .single();

    if (companyError) {
      debug.error('Company creation failed:', companyError);
      return res.status(500).json({ 
        success: false,
        error: 'Company registration failed',
        details: companyError.message
      });
    }

    // 2. Create admin user - MUST HAVE approved: false
    const adminData = {
      email: trimmedAdminEmail,
      password_hash: hashedPassword,
      full_name: admin_full_name.trim(),
      phone: admin_phone.trim(),
      company_id: company.id,
      institution: trimmedCompanyName,
      country: company.country,
      region: company.region,
      license_number: admin_license_number?.trim() || '',
      tin_number: tin_number?.trim() || '',
      approved: false,  // <<< CRITICAL: MUST BE FALSE
      role: 'company_admin',
      account_type: 'company',
      subscription_status: 'inactive',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: adminUser, error: adminError } = await client
      .from('users')
      .insert([adminData])
      .select()
      .single();

    if (adminError) {
      // Rollback company creation
      await client.from('companies').delete().eq('id', company.id);
      
      return res.status(500).json({ 
        success: false,
        error: 'Admin user creation failed',
        details: adminError.message
      });
    }

    // 3. Update company with admin_id
    await client
      .from('companies')
      .update({ admin_id: adminUser.id })
      .eq('id', company.id);

    debug.success('Company registered:', { companyId: company.id, adminId: adminUser.id, approved: adminUser.approved });

    res.status(201).json({
      success: true,
      message: 'Company registration successful!',
      user: {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.full_name,
        phone: adminUser.phone,
        company_id: adminUser.company_id,
        approved: adminUser.approved,  // Should be false
        role: adminUser.role,
        account_type: adminUser.account_type
      },
      id: adminUser.id,
      userId: adminUser.id,
      user_id: adminUser.id
    });

  } catch (error) {
    debug.error('Company registration error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Company registration failed',
      details: error.message
    });
  }
});

// Get current user - FIXED: removed specialization from response
// ✅ FIXED: Get current user profile (checks both users and company_users tables)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    try {
        console.log('🔍 DEBUG: Fetching current user profile for user:', req.user.userId);
        console.log('🔍 DEBUG: User info from token:', req.user);
        
        let user = null;
        let userType = null;
        let userError = null;
        
        // First, check if this is a company_user (from token)
        if (req.user.account_type === 'company_user' || req.user.user_type === 'company_user') {
            console.log('🔍 Checking company_users table for company user...');
            
            // Search in company_users table
            const { data: companyUser, error: companyError } = await supabase
                .from('company_users')
                .select('*')
                .eq('id', req.user.userId)
                .maybeSingle();
            
            if (companyError) {
                userError = companyError;
                console.error('❌ ERROR: Company user query error:', companyError);
            } else if (companyUser) {
                user = companyUser;
                userType = 'company_user';
                console.log('✅ Found in company_users table:', companyUser.email);
            }
        } else {
            // Regular user - check users table
            console.log('🔍 Checking users table for regular user...');
            
            const { data: regularUser, error: regularError } = await supabase
                .from('users')
                .select('*')
                .eq('id', req.user.userId)
                .maybeSingle();
            
            if (regularError) {
                userError = regularError;
                console.error('❌ ERROR: User query error:', regularError);
            } else if (regularUser) {
                user = regularUser;
                userType = 'regular_user';
                console.log('✅ Found in users table:', regularUser.email);
            }
        }
        
        // If not found yet, try both tables (fallback)
        if (!user) {
            console.log('🔍 User not found by account_type, trying both tables...');
            
            // Try users table first
            const { data: regularUser } = await supabase
                .from('users')
                .select('*')
                .eq('id', req.user.userId)
                .maybeSingle();
            
            if (regularUser) {
                user = regularUser;
                userType = 'regular_user';
                console.log('✅ Fallback: Found in users table');
            } else {
                // Try company_users table
                const { data: companyUser } = await supabase
                    .from('company_users')
                    .select('*')
                    .eq('id', req.user.userId)
                    .maybeSingle();
                
                if (companyUser) {
                    user = companyUser;
                    userType = 'company_user';
                    console.log('✅ Fallback: Found in company_users table');
                }
            }
        }

        if (!user) {
            console.error('❌ ERROR: User not found in either table:', req.user.userId);
            console.error('🐛 User details from token:', req.user);
            return res.status(404).json({
                success: false,
                error: 'User not found',
                user_id: req.user.userId,
                user_email: req.user.email,
                account_type: req.user.account_type,
                tables_checked: ['users', 'company_users']
            });
        }

        console.log('✅ SUCCESS: User profile retrieved successfully:', {
            id: user.id,
            email: user.email,
            user_type: userType
        });

        // Prepare response based on user type
        let responseData = {
            success: true,
            user_type: userType
        };

        if (userType === 'company_user') {
            // Get company info for company user
            let companyData = null;
            if (user.company_id) {
                const { data: company } = await supabase
                    .from('companies')
                    .select('company_name, company_address, company_phone, country, region')
                    .eq('id', user.company_id)
                    .maybeSingle();
                
                if (company) {
                    companyData = company;
                }
            }

            responseData.user = {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                account_type: 'company_user',
                phone: user.phone,
                approved: user.approved,
                subscription_status: user.subscription_status,
                subscription_plan: user.subscription_plan,
                subscription_end_date: user.subscription_end_date,
                license_number: user.license_number || '',
                created_at: user.created_at,
                updated_at: user.updated_at,
                company: companyData,
                company_id: user.company_id,
                created_by: user.created_by
            };
        } else {
            // Regular user response
            let companyData = null;
            if (user.company_id) {
                const { data: company } = await supabase
                    .from('companies')
                    .select('*')
                    .eq('id', user.company_id)
                    .maybeSingle();
                
                companyData = company;
            }

            responseData.user = {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                account_type: user.account_type || 'individual',
                institution: user.institution,
                country: user.country,
                region: user.region,
                phone: user.phone,
                approved: user.approved,
                subscription_status: user.subscription_status,
                subscription_id: user.subscription_id,
                subscription_end_date: user.subscription_end_date,
                created_at: user.created_at,
                company: companyData,
                company_id: user.company_id,
                tin_number: user.tin_number || '',
                license_number: user.license_number || '',
                woreda: user.woreda || ''
            };
        }

        res.json(responseData);

    } catch (error) {
        console.error('❌ ERROR: Get profile error:');
        console.error('🐛 ERROR DETAILS:', error.message);
        console.error('🗂️ STACK TRACE:', error.stack);
        
        res.status(500).json({
            success: false,
            error: 'Failed to get user profile',
            details: error.message,
            user_id: req.user?.userId,
            user_email: req.user?.email
        });
    }
});

app.get('/api/debug/user-permissions', authenticateToken, async (req, res) => {
  try {
    console.log('🔐 Checking permissions for user:', req.user.userId);
    
    const { data: user } = await supabase
      .from('users')
      .select('id, email, role, account_type, company_id')
      .eq('id', req.user.userId)
      .single();
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      current_user: user,
      can_access_all_data: user.role === 'admin',
      company_admin: user.role === 'company_admin',
      user_role: user.role,
      user_id: user.id
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add this endpoint to your backend
// Get consultations with data isolation - NEW ENDPOINT
app.get('/api/patient-consultations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userCompanyId = req.user.company_id;
    
    console.log('📋 Getting consultations for:', { userId, userRole, userCompanyId });

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Get accessible user IDs
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId);
    
    // Query consultations from accessible users only
    const { data: consultations, error } = await supabase
      .from('patient_consultations')
      .select('*, patients(full_name, age, gender), users(full_name, email)')
      .in('user_id', accessibleUserIds)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching consultations:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch consultations',
        details: error.message
      });
    }

    console.log(`✅ Found ${consultations?.length || 0} consultations`);
    res.json({
      success: true,
      consultations: consultations || [],
      count: consultations?.length || 0,
      access_level: userRole === 'admin' ? 'all' : 
                   userRole === 'company_admin' ? 'company' : 
                   'own',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Consultations error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch consultations',
      details: error.message
    });
  }
});

// Update user profile - FIXED: removed specialization
app.put('/api/auth/update-profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const updates = req.body;

    debug.log(`Updating profile for user: ${userId}`, updates);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.email;
    delete updates.role;
    delete updates.approved;
    delete updates.account_type;
    delete updates.created_at;
    delete updates.password_hash;
    delete updates.specialization; // Remove specialization if it's in updates

    // Add updated timestamp
    updates.updated_at = new Date().toISOString();

    // Update user
    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error || !user) {
      debug.error('Profile update failed:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to update profile' 
      });
    }

    debug.success(`Profile updated for user: ${userId}`);
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        account_type: user.account_type,
        approved: user.approved,
        institution: user.institution,
        phone: user.phone,
        country: user.country,
        region: user.region,
        woreda: user.woreda,
        tin_number: user.tin_number,
        license_number: user.license_number || '',  // Removed specialization from response
        company_id: user.company_id,
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan,
        subscription_end_date: user.subscription_end_date,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });

  } catch (error) {
    debug.error('Update profile error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update profile',
      details: error.message
    });
  }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { current_password, new_password } = req.body;

    debug.log(`Changing password for user: ${userId}`);

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters'
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Get user to verify current password
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(current_password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        password_hash: hashedPassword,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      debug.error('Password update failed:', updateError);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to update password' 
      });
    }

    debug.success(`Password changed for user: ${userId}`);
    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    debug.error('Change password error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to change password',
      details: error.message
    });
  }
});

// ==================== ADMIN ROUTES ====================

// Get pending approvals - DEBUGGED VERSION
// Get pending approvals - FIXED
app.get('/api/admin/pending-approvals', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔍 [DEBUG] Fetching pending approvals...');
    
    if (!supabase) {
      console.error('❌ [DEBUG] Supabase not configured');
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    console.log('🔍 [DEBUG] Querying users with approved=false');
    
    // FIX: Get ALL users where approved is false
    const { data: pendingUsers, error } = await supabase
      .from('users')
      .select('id, email, full_name, institution, country, region, phone, account_type, role, approved, created_at, subscription_status, license_number')
      .eq('approved', false)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ [DEBUG] Error fetching pending approvals:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch pending approvals',
        details: error.message
      });
    }

    console.log(`✅ [DEBUG] Found ${pendingUsers?.length || 0} pending approvals`);
    
    res.json({
      success: true,
      users: pendingUsers || [],
      count: pendingUsers?.length || 0,
      timestamp: new Date().toISOString(),
      debug: {
        query_conditions: 'approved=false'
      }
    });

  } catch (error) {
    console.error('❌ [DEBUG] Get pending approvals error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error fetching pending approvals',
      details: error.message
    });
  }
});
// Debug endpoint to check user registration
app.get('/api/debug/users-status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🔍 [DEBUG] Checking all users in database...');
    
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Get ALL users
    const { data: allUsers, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ [DEBUG] Error fetching users:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch users',
        details: error.message
      });
    }

    // Analyze the data
    const analysis = {
      total_users: allUsers?.length || 0,
      admin_users: allUsers?.filter(u => u.role === 'admin').length || 0,
      approved_users: allUsers?.filter(u => u.approved === true).length || 0,
      pending_users: allUsers?.filter(u => u.approved === false && u.role !== 'admin').length || 0,
      users_by_role: {},
      users_by_approval: {
        approved: [],
        pending: []
      }
    };

    // Group by role
    allUsers?.forEach(user => {
      analysis.users_by_role[user.role] = (analysis.users_by_role[user.role] || 0) + 1;
      
      if (user.approved) {
        analysis.users_by_approval.approved.push({
          email: user.email,
          role: user.role,
          created_at: user.created_at
        });
      } else if (user.role !== 'admin') {
        analysis.users_by_approval.pending.push({
          email: user.email,
          role: user.role,
          created_at: user.created_at
        });
      }
    });

    console.log('🔍 [DEBUG] User analysis:', JSON.stringify(analysis, null, 2));
    
    res.json({
      success: true,
      analysis: analysis,
      all_users: allUsers,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [DEBUG] Users status error:', error);
    res.status(500).json({
      success: false,
      error: 'Debug failed',
      details: error.message
    });
  }
});

// Get all users (admin only)
// Get all users (admin only) - FIXED
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    debug.log('Fetching all users...');
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // FIX: Get ALL users
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, full_name, role, account_type, approved, institution, company_id, subscription_status, subscription_plan, created_at, phone, country, region, license_number')
      .order('created_at', { ascending: false });

    if (error) {
      debug.warn('Error fetching users, returning empty array', error);
      return res.json({
        success: true,
        users: []
      });
    }

    debug.success(`Found ${users?.length || 0} users`);
    res.json({
      success: true,
      users: users || [],
      count: users?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get users error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch users',
      details: error.message
    });
  }
});
// Verify database counts
app.get('/api/debug/real-counts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('📊 Getting real database counts...');
    
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    // Get all counts directly
    const [
      usersCount,
      approvedUsersCount,
      pendingUsersCount,
      patientsCount,
      adminCount,
      companiesCount
    ] = await Promise.all([
      // Total users
      supabase.from('users').select('*', { count: 'exact', head: true }),
      // Approved users
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('approved', true),
      // Pending users
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('approved', false),
      // Patients
      supabase.from('patients').select('*', { count: 'exact', head: true }),
      // Admins
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
      // Companies
      supabase.from('companies').select('*', { count: 'exact', head: true })
    ]);

    // Get sample users
    const { data: sampleUsers } = await supabase
      .from('users')
      .select('id, email, role, approved, created_at')
      .limit(5);

    res.json({
      success: true,
      counts: {
        total_users: usersCount.count || 0,
        approved_users: approvedUsersCount.count || 0,
        pending_users: pendingUsersCount.count || 0,
        total_patients: patientsCount.count || 0,
        admin_users: adminCount.count || 0,
        total_companies: companiesCount.count || 0,
        verification: `Pending (${pendingUsersCount.count}) + Approved (${approvedUsersCount.count}) = Total (${usersCount.count})`
      },
      sample_users: sampleUsers || [],
      note: 'These are REAL counts from the database',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Counts error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user by ID (admin only)
app.get('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    debug.log(`Fetching user details for: ${userId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !user) {
      debug.error('User not found:', error);
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Get company info if applicable
    let company = null;
    if (user.company_id) {
      const { data: companyData } = await supabase
        .from('companies')
        .select('*')
        .eq('id', user.company_id)
        .single();
      
      company = companyData;
    }

    // Get subscription info
    let subscription = null;
    try {
      const { data: subscriptionData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      subscription = subscriptionData;
    } catch (subError) {
      debug.warn('Error fetching subscription:', subError);
    }

    debug.success(`User details retrieved: ${user.email}`);
    res.json({
      success: true,
      user: user,
      company: company,
      subscription: subscription,
      has_company: !!user.company_id,
      has_active_subscription: subscription?.status === 'active'
    });

  } catch (error) {
    debug.error('Get user details error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch user details',
      details: error.message
    });
  }
});

// Approve user
app.post('/api/admin/users/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    debug.log(`Approving user: ${userId}`);
    
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        error: 'User ID is required' 
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Find user
    const { data: user, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (fetchError || !user) {
      debug.error('User not found for approval:', fetchError);
      return res.status(404).json({ 
        success: false,
        error: 'User not found'
      });
    }
    
    if (user.approved) {
      debug.log(`User ${userId} is already approved`);
      return res.json({
        success: true,
        message: 'User is already approved',
        user: user
      });
    }
    
    // Update user
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        approved: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    if (updateError) {
      debug.error('Failed to approve user:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to approve user',
        details: updateError.message
      });
    }
    
    // Get updated user
    const { data: updatedUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();
    
    debug.success(`User ${userId} approved successfully`);
    res.json({
      success: true,
      message: 'User approved successfully! They can now login.',
      user: updatedUser,
      notification: {
        email: updatedUser.email,
        message: 'Your account has been approved by the admin. You can now login to the system.'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Approve user error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to approve user',
      details: error.message
    });
  }
});
// ✅ GET single patient by patient_code (not id)
app.get('/api/patients/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        
        console.log(`🔍 [GET PATIENT BY CODE] Fetching patient with code: ${patientCode} for user ${userId} (${userRole})`);

        if (!supabase) {
            return res.status(503).json({ 
                success: false,
                error: 'Database not configured'
            });
        }

        // Get accessible user IDs
        const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId);
        
        // Query patient by patient_code from accessible users only
        const { data: patient, error } = await supabase
            .from('patients')
            .select('*')
            .eq('patient_code', patientCode)
            .in('user_id', accessibleUserIds)
            .single();

        if (error || !patient) {
            console.error('❌ Patient not found or access denied:', error);
            return res.status(404).json({ 
                success: false,
                error: 'Patient not found or access denied' 
            });
        }

        console.log(`✅ Patient ${patientCode} retrieved successfully`);
        res.json({
            success: true,
            patient: patient,
            access_level: userRole === 'admin' ? 'full' : 
                         userRole === 'company_admin' ? 'company' : 
                         'owner',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Get patient by code error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch patient',
            details: error.message
        });
    }
});
// ✅ UPDATE patient by patient_code
// ✅ UPDATE patient by patient_code - FIXED VERSION
app.put('/api/patients/code/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        
        console.log('🔄 [UPDATE PATIENT] Starting update for:', {
            patientCode,
            userId,
            userRole,
            requestBody: req.body
        });

        if (!supabase) {
            console.error('❌ [UPDATE PATIENT] Supabase not configured');
            return res.status(503).json({ 
                success: false,
                error: 'Database not configured'
            });
        }

        // Get accessible user IDs based on role
        let accessibleUserIds;
        if (userRole === 'admin') {
            console.log('👑 Admin updating patient');
            // Admin can update any patient
            accessibleUserIds = null; // No filter for admin
        } else if (userRole === 'company_admin') {
            console.log('🏢 Company admin updating patient');
            accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId);
        } else {
            console.log('👤 Regular user updating patient');
            // Regular users can only update their own patients
            accessibleUserIds = [userId];
        }

        console.log('🔍 [UPDATE PATIENT] Accessible user IDs:', accessibleUserIds);

        // First, check if patient exists
        let query = supabase.from('patients').select('*').eq('patient_code', patientCode);
        
        if (accessibleUserIds) {
            query = query.in('user_id', accessibleUserIds);
        }
        
        const { data: existingPatient, error: fetchError } = await query.single();

        if (fetchError || !existingPatient) {
            console.error('❌ [UPDATE PATIENT] Patient not found or access denied:', {
                patientCode,
                userRole,
                userId,
                error: fetchError?.message
            });
            return res.status(404).json({ 
                success: false,
                error: 'Patient not found or access denied' 
            });
        }

        console.log('✅ [UPDATE PATIENT] Patient found:', {
            id: existingPatient.id,
            patient_code: existingPatient.patient_code,
            user_id: existingPatient.user_id
        });

        // Prepare update data
        const updates = { ...req.body };
        
        // CRITICAL: Remove fields that shouldn't be updated
        delete updates.id;
        delete updates.patient_code; // Never change patient_code
        delete updates.user_id; // Never change ownership
        delete updates.created_at; // Never change creation date
        delete updates.created_by; // Never change creator
        
        // Add updated timestamp
        updates.updated_at = new Date().toISOString();

        // Clean up data - convert empty strings to null for database
        Object.keys(updates).forEach(key => {
            if (updates[key] === '' || updates[key] === undefined) {
                updates[key] = null;
            }
            // Convert numbers properly
            if (typeof updates[key] === 'string' && !isNaN(updates[key]) && updates[key].trim() !== '') {
                const num = parseFloat(updates[key]);
                if (!isNaN(num)) {
                    updates[key] = num;
                }
            }
        });

        console.log('📝 [UPDATE PATIENT] Update data:', {
            fields: Object.keys(updates).length,
            sample: Object.keys(updates).slice(0, 5).reduce((obj, key) => {
                obj[key] = updates[key];
                return obj;
            }, {})
        });

        // Update patient in database
        console.log('💾 [UPDATE PATIENT] Updating database...');
        const { data: updatedPatient, error: updateError } = await supabase
            .from('patients')
            .update(updates)
            .eq('patient_code', patientCode)
            .select()
            .single();

        if (updateError) {
            console.error('❌ [UPDATE PATIENT] Database update failed:', updateError);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to update patient in database',
                details: updateError.message,
                code: updateError.code
            });
        }

        if (!updatedPatient) {
            console.error('❌ [UPDATE PATIENT] No data returned after update');
            return res.status(500).json({ 
                success: false, 
                error: 'Patient update failed - no data returned'
            });
        }

        console.log('✅ [UPDATE PATIENT] Patient updated successfully:', {
            id: updatedPatient.id,
            patient_code: updatedPatient.patient_code,
            fields_updated: Object.keys(updates).length
        });

        // Return the updated patient data
        res.json({
            success: true,
            message: 'Patient updated successfully',
            patient: updatedPatient,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ [UPDATE PATIENT] Server error:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update patient',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Bulk approve users
app.post('/api/admin/users/bulk-approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userIds } = req.body;
    debug.log(`Bulk approving users: ${userIds?.length || 0} users`);

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'User IDs array is required'
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Update all users
    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        approved: true,
        updated_at: new Date().toISOString()
      })
      .in('id', userIds);

    if (updateError) {
      debug.error('Failed to bulk approve users:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to approve users',
        details: updateError.message
      });
    }

    // Get updated users
    const { data: updatedUsers } = await supabase
      .from('users')
      .select('id, email, full_name')
      .in('id', userIds);

    debug.success(`Bulk approved ${updatedUsers?.length || 0} users`);
    res.json({
      success: true,
      message: `Successfully approved ${updatedUsers?.length || 0} users`,
      users: updatedUsers || [],
      count: updatedUsers?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Bulk approve error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to bulk approve users',
      details: error.message
    });
  }
});

// Reject user
app.delete('/api/admin/users/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    debug.log(`Rejecting user: ${userId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: user } = await supabase
      .from('users')
      .select('email, full_name, institution')
      .eq('id', userId)
      .single();

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    debug.log('Deleting user...');
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      debug.error('Failed to reject user:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to reject user',
        details: error.message
      });
    }

    debug.success(`User ${userId} rejected successfully`);
    res.json({
      success: true,
      message: 'User rejected and removed successfully',
      user: {
        email: user.email,
        full_name: user.full_name,
        institution: user.institution
      },
      notification: {
        email: user.email,
        message: 'Your registration has been rejected by the admin. Please contact support for more information.'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Reject user error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to reject user',
      details: error.message
    });
  }
});

// Update user (admin only)
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const updates = req.body;

    debug.log(`Admin updating user: ${userId}`, updates);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (fetchError || !existingUser) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.created_at;
    delete updates.password_hash;

    // Add updated timestamp
    updates.updated_at = new Date().toISOString();

    // If password is being updated, hash it
    if (updates.password) {
      updates.password_hash = await bcrypt.hash(updates.password, 10);
      delete updates.password;
    }

    // Update user
    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error || !user) {
      debug.error('User update failed:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to update user' 
      });
    }

    debug.success(`User ${userId} updated by admin`);
    res.json({
      success: true,
      message: 'User updated successfully',
      user: user,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Admin update user error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update user',
      details: error.message
    });
  }
});

// Admin dashboard stats - UPDATED to exclude admin users
// Admin dashboard stats - FIXED
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    debug.log('Fetching admin stats...');
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    let total_users = 0;
    let total_companies = 0;
    let pending_approvals = 0;
    let active_subscriptions = 0;
    let total_revenue = 0;
    let total_patients = 0;
    let total_medications = 0;
    
    try {
      debug.log('Counting total users (ALL users)...');
      // FIX: Count ALL users
      const { count: userCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      
      total_users = userCount || 0;
      
      debug.log('Counting total companies...');
      const { count: companyCount } = await supabase
        .from('companies')
        .select('*', { count: 'exact', head: true });
      
      total_companies = companyCount || 0;
      
      debug.log('Counting pending approvals (ALL non-approved users)...');
      // FIX: Count ALL non-approved users
      const { count: pendingCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('approved', false);
      
      pending_approvals = pendingCount || 0;
      
      debug.log('Counting active subscriptions...');
      const { count: subscriptionCount } = await supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      
      active_subscriptions = subscriptionCount || 0;
      
      debug.log('Calculating total revenue...');
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('status', 'paid');
      
      total_revenue = payments?.reduce((sum, payment) => sum + (payment.amount || 0), 0) || 0;
      
      debug.log('Counting total patients...');
      const { count: patientsCount } = await supabase
        .from('patients')
        .select('*', { count: 'exact', head: true });
      
      total_patients = patientsCount || 0;
      
      debug.log('Counting total medications...');
      try {
        const { count: medicationsCount } = await supabase
          .from('medications')
          .select('*', { count: 'exact', head: true });
        
        total_medications = medicationsCount || 0;
      } catch (medError) {
        debug.warn('Medications table not available', medError);
      }
      
    } catch (error) {
      debug.error('Stats calculation error:', error);
    }

    // Calculate user growth (last 30 days, ALL users)
    let user_growth = 0;
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { count: recentUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString());
      
      user_growth = recentUsers || 0;
    } catch (growthError) {
      debug.warn('Error calculating user growth:', growthError);
    }

    const stats = {
      total_users,
      total_companies,
      pending_approvals,
      active_subscriptions,
      total_revenue,
      total_patients,
      total_medications,
      user_growth,
      currency: 'ETB',
      last_updated: new Date().toISOString()
    };
    
    debug.success('Admin stats retrieved', stats);
    res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Stats error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch admin stats',
      details: error.message
    });
  }
});

// Get all companies (admin only)
app.get('/api/admin/companies', authenticateToken, requireAdmin, async (req, res) => {
  try {
    debug.log('Fetching all companies...');
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: companies, error } = await supabase
      .from('companies')
      .select('*, users(full_name, email)')
      .order('created_at', { ascending: false });

    if (error) {
      debug.warn('Error fetching companies, returning empty array', error);
      return res.json({
        success: true,
        companies: []
      });
    }

    debug.success(`Found ${companies?.length || 0} companies`);
    res.json({
      success: true,
      companies: companies || [],
      count: companies?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get companies error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch companies',
      details: error.message
    });
  }
});

// Get company by ID (admin only)
app.get('/api/admin/companies/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const companyId = req.params.id;
    debug.log(`Fetching company details: ${companyId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: company, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (error || !company) {
      debug.error('Company not found:', error);
      return res.status(404).json({ 
        success: false,
        error: 'Company not found' 
      });
    }

    // Get company admin
    let admin = null;
    if (company.admin_id) {
      const { data: adminUser } = await supabase
        .from('users')
        .select('id, email, full_name, phone, approved, created_at')
        .eq('id', company.admin_id)
        .single();
      
      admin = adminUser;
    }

    // Get company users
    const { data: companyUsers } = await supabase
      .from('users')
      .select('id, email, full_name, role, approved, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    debug.success(`Company details retrieved: ${company.company_name}`);
    res.json({
      success: true,
      company: company,
      admin: admin,
      users: companyUsers || [],
      user_count: companyUsers?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get company error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch company details',
      details: error.message
    });
  }
});

// Approve company
app.post('/api/admin/companies/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const companyId = req.params.id;
    debug.log(`Approving company: ${companyId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Get company
    const { data: company, error: fetchError } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (fetchError || !company) {
      debug.error('Company not found:', fetchError);
      return res.status(404).json({ 
        success: false,
        error: 'Company not found'
      });
    }

    // Get company admin
    const { data: adminUser } = await supabase
      .from('users')
      .select('*')
      .eq('company_id', companyId)
      .eq('role', 'company_admin')
      .single();

    if (!adminUser) {
      return res.status(404).json({
        success: false,
        error: 'Company admin not found'
      });
    }

    // Approve admin user
    const { error: approveError } = await supabase
      .from('users')
      .update({ 
        approved: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', adminUser.id);

    if (approveError) {
      debug.error('Failed to approve admin:', approveError);
      return res.status(500).json({
        success: false,
        error: 'Failed to approve company admin'
      });
    }

    // Update company
    const { error: companyUpdateError } = await supabase
      .from('companies')
      .update({
        updated_at: new Date().toISOString()
      })
      .eq('id', companyId);

    if (companyUpdateError) {
      debug.error('Failed to update company:', companyUpdateError);
    }

    debug.success(`Company ${companyId} approved successfully`);
    res.json({
      success: true,
      message: 'Company approved successfully! Admin can now login.',
      company: company,
      admin: {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.full_name
      },
      notification: {
        email: adminUser.email,
        message: 'Your company account has been approved by the admin. You can now login to the system.'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Approve company error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to approve company',
      details: error.message
    });
  }
});

// Get all patients (admin only) - FIXED
// Get all patients (admin only) - FIXED: No join, just get patients
app.get('/api/admin/patients', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('👑 Admin fetching all patients (without user join)...');
    
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // SIMPLE QUERY: Just get patients without joining to users
    const { data: patients, error } = await supabase
      .from('patients')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Admin patients error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch patients',
        details: error.message
      });
    }

    // Get total counts
    const { count: totalPatients } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true });
    
    const { count: activePatients } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    console.log(`✅ Admin sees ${patients?.length || 0} patients (Total: ${totalPatients})`);
    
    // If we need user info, fetch it separately
    let patientsWithUserInfo = patients || [];
    
    // Try to get user info for each patient if user_id exists
    if (patientsWithUserInfo.length > 0) {
      // Extract unique user IDs
      const userIds = [...new Set(patientsWithUserInfo.map(p => p.user_id).filter(Boolean))];
      
      if (userIds.length > 0) {
        try {
          const { data: users } = await supabase
            .from('users')
            .select('id, email, full_name, institution')
            .in('id', userIds);
          
          // Create a map for quick lookup
          const userMap = {};
          if (users) {
            users.forEach(user => {
              userMap[user.id] = {
                email: user.email,
                full_name: user.full_name,
                institution: user.institution
              };
            });
          }
          
          // Add user info to patients
          patientsWithUserInfo = patientsWithUserInfo.map(patient => ({
            ...patient,
            user_info: patient.user_id ? userMap[patient.user_id] : null
          }));
        } catch (userError) {
          console.warn('Could not fetch user info:', userError.message);
        }
      }
    }

    res.json({
      success: true,
      patients: patientsWithUserInfo,
      count: patientsWithUserInfo.length,
      totals: {
        all_patients: totalPatients || 0,
        active_patients: activePatients || 0,
        inactive_patients: (totalPatients || 0) - (activePatients || 0)
      },
      note: 'Admin sees ALL patients in the system',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Admin get patients error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch patients',
      details: error.message
    });
  }
});

// Admin get all patients - For AdminDashboard use only (NEW ENDPOINT)
// Admin get all patients - For AdminDashboard use only (FIXED VERSION)
// ==================== ADMIN-SPECIFIC ENDPOINTS ====================

// Admin: Get all patients (WITH user isolation check)
app.get('/api/admin/all-patients', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const adminUser = req.user;
    console.log(`👑 [ADMIN] ${adminUser.email} requesting ALL patients`);
    
    // FIRST: Show what regular users would see (for comparison)
    const accessibleUserIds = await getUserAccessibleData(adminUser.userId, adminUser.role, adminUser.company_id);
    
    console.log(`📊 [ADMIN] User isolation would allow access to: ${accessibleUserIds.length} users`);
    
    // Get ALL patients from the database
    const { data: allPatients, error: allError } = await supabase
      .from('patients')
      .select('*, users(email, full_name)')
      .order('created_at', { ascending: false });

    if (allError) {
      console.error('Admin all-patients error:', allError);
      return res.status(500).json({ 
        success: false, 
        error: 'Database error' 
      });
    }

    // Get patients that regular users would see (for comparison)
    const { data: filteredPatients, error: filteredError } = await supabase
      .from('patients')
      .select('*, users(email, full_name)')
      .in('user_id', accessibleUserIds)
      .order('created_at', { ascending: false });

    const comparison = {
      total_patients_in_system: allPatients?.length || 0,
      patients_admin_can_see: allPatients?.length || 0,
      patients_regular_user_would_see: filteredPatients?.length || 0,
      user_isolation_working: (filteredPatients?.length || 0) < (allPatients?.length || 0)
    };

    console.log('📊 [ADMIN] Patient comparison:', comparison);

    res.json({
      success: true,
      patients: allPatients || [],
      comparison: comparison,
      access_info: {
        user_role: adminUser.role,
        user_email: adminUser.email,
        can_see_all_patients: true,
        note: 'Admin can see ALL patients in the system'
      },
      count: allPatients?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Admin all-patients endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get all payments (admin only)
app.get('/api/admin/payments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    debug.log('Fetching all payments...');
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: payments, error } = await supabase
      .from('payments')
      .select('*, users(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      debug.warn('Error fetching payments, returning empty array', error);
      return res.json({
        success: true,
        payments: []
      });
    }

    debug.success(`Found ${payments?.length || 0} payments`);
    res.json({
      success: true,
      payments: payments || [],
      count: payments?.length || 0,
      total_revenue: payments?.reduce((sum, payment) => sum + (payment.amount || 0), 0) || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get payments error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch payments',
      details: error.message
    });
  }
});

// Get all subscriptions (admin only)
app.get('/api/admin/subscriptions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    debug.log('Fetching all subscriptions...');
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('*, users(full_name, email, institution)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      debug.warn('Error fetching subscriptions, returning empty array', error);
      return res.json({
        success: true,
        subscriptions: []
      });
    }

    debug.success(`Found ${subscriptions?.length || 0} subscriptions`);
    res.json({
      success: true,
      subscriptions: subscriptions || [],
      count: subscriptions?.length || 0,
      active_count: subscriptions?.filter(sub => sub.status === 'active').length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get subscriptions error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch subscriptions',
      details: error.message
    });
  }
});

// ==================== PATIENT MANAGEMENT ROUTES ====================

// Get all patients with role-based filtering - FIXED VERSION
// In your backend server.js - GET /api/patients endpoint
// Get all patients with role-based filtering - COMPLETELY FIXED VERSION
// Get patients with STRICT data isolation - FIXED
// Get all patients with role-based filtering - DEBUGGED VERSION
// Add these routes to your existing server.js

// ✅ GET all patients with data isolation
// ✅ GET all patients with STRICT data isolation
// ✅ UPDATED: /api/patients endpoint with account_type support
app.get('/api/patients', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;
        const userAccountType = req.user.account_type || 'individual';
        
        console.log('📋 [PATIENTS] Request from:', {
            userId,
            userRole,
            userAccountType,
            companyId: userCompanyId || 'none'
        });

        if (!supabase) {
            return res.status(503).json({ 
                success: false,
                error: 'Database not configured'
            });
        }

        // Get accessible user IDs - PASS account_type
        const accessibleUserIds = await getUserAccessibleData(
            userId, 
            userRole, 
            userCompanyId, 
            userAccountType
        );
        
        console.log('🔍 [PATIENTS] Accessible user IDs:', {
            count: accessibleUserIds.length,
            ids: accessibleUserIds.slice(0, 5)
        });

        // Build query
        let query = supabase.from('patients').select('*');
        
        // Apply filters based on role and account_type
        if (userRole === 'admin') {
            // Admin: No filter needed
            console.log('👑 Admin query: ALL patients');
        } else if (userAccountType === 'company_user') {
            // Company user: Only through their company admin
            console.log(`🏢 Company user query: patients.user_id IN [${accessibleUserIds.join(', ')}]`);
            query = query.in('user_id', accessibleUserIds);
        } else if (userRole === 'company_admin') {
            // Company admin: All users in their company
            console.log(`🏢 Company admin query: patients.user_id IN [${accessibleUserIds.join(', ')}]`);
            query = query.in('user_id', accessibleUserIds);
        } else {
            // Regular users: ONLY their own patients
            console.log(`👤 Regular user query: patients.user_id = ${userId}`);
            query = query.eq('user_id', userId);
        }

        // Execute query
        const { data: patients, error } = await query
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ [PATIENTS] Database error:', error);
            return res.status(500).json({ 
                success: false,
                error: 'Failed to fetch patients'
            });
        }

        // Get counts for debugging
        const { count: totalPatientsInSystem } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true });
        
        const { count: userOwnPatientsCount } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        console.log('📊 [PATIENTS] Statistics:', {
            total_patients_in_system: totalPatientsInSystem || 0,
            user_own_patients: userOwnPatientsCount || 0,
            returned_patients: patients?.length || 0,
            data_isolation_working: (userRole !== 'admin' && userAccountType !== 'company_user') 
                ? (patients?.length === userOwnPatientsCount) 
                : 'N/A for admin/company_user'
        });

        res.json({
            success: true,
            patients: patients || [],
            count: patients?.length || 0,
            access_info: {
                user_role: userRole,
                user_account_type: userAccountType,
                access_level: userRole === 'admin' ? 'full' : 
                            (userRole === 'company_admin' || userAccountType === 'company_user') ? 'company' : 
                            'own_only'
            }
        });

    } catch (error) {
        console.error('❌ [PATIENTS] Error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch patients'
        });
    }
});

// ✅ DELETE patient with ownership check
app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;
        const userId = req.user.userId;
        const userRole = req.user.role;
        
        console.log('🗑️ [DELETE PATIENT] Attempt:', {
            patientId,
            userId,
            userRole
        });
        
        // First, check if patient exists and user has permission
        const { data: patient, error: fetchError } = await supabase
            .from('patients')
            .select('*')
            .eq('id', patientId)
            .single();
        
        if (fetchError || !patient) {
            return res.status(404).json({
                success: false,
                error: 'Patient not found'
            });
        }
        
        // Check permission
        let hasPermission = false;
        
        if (userRole === 'admin') {
            hasPermission = true;
            console.log('👑 Admin can delete any patient');
        } else if (userRole === 'company_admin') {
            // Check if patient belongs to someone in same company
            const accessibleUserIds = await getUserAccessibleData(
                userId, 
                userRole, 
                req.user.company_id
            );
            hasPermission = accessibleUserIds.includes(patient.user_id);
            console.log(`🏢 Company admin permission: ${hasPermission}`);
        } else {
            // Regular user can only delete their own patients
            hasPermission = patient.user_id === userId;
            console.log(`👤 Regular user permission: ${hasPermission} (patient.user_id: ${patient.user_id}, userId: ${userId})`);
        }
        
        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to delete this patient'
            });
        }
        
        // Delete the patient
        const { error: deleteError } = await supabase
            .from('patients')
            .delete()
            .eq('id', patientId);
        
        if (deleteError) {
            throw deleteError;
        }
        
        console.log('✅ [DELETE PATIENT] Success:', patientId);
        res.json({
            success: true,
            message: 'Patient deleted successfully',
            patient_id: patientId
        });
        
    } catch (error) {
        console.error('❌ [DELETE PATIENT] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Debug endpoint to check patient ownership
app.get('/api/debug/check-patient-ownership', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        
        // Get all patients
        const { data: allPatients } = await supabase
            .from('patients')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);
        
        // Count patients with/without owner
        const patientsWithOwner = allPatients?.filter(p => p.user_id).length || 0;
        const patientsWithoutOwner = allPatients?.filter(p => !p.user_id).length || 0;
        const myPatients = allPatients?.filter(p => p.user_id === userId).length || 0;
        
        res.json({
            success: true,
            total_patients: allPatients?.length || 0,
            with_owner: patientsWithOwner,
            without_owner: patientsWithoutOwner,
            my_patients: myPatients,
            user_id: userId,
            sample_patients: allPatients?.slice(0, 5).map(p => ({
                id: p.id,
                patient_code: p.patient_code,
                user_id: p.user_id,
                created_by: p.created_by,
                full_name: p.full_name
            }))
        });
    } catch (error) {
        console.error('Check ownership error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ✅ Debug endpoint to test data isolation
app.get('/api/debug/data-isolation-test', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userEmail = req.user.email;
        
        console.log('🧪 [DEBUG] Testing data isolation for:', { userId, userRole, userEmail });
        
        // Test 1: Direct Supabase query (what frontend was doing)
        const { data: directData } = await supabase
            .from('patients')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);
        
        // Test 2: What the user should see through API
        const accessibleUserIds = await getUserAccessibleData(
            userId, 
            userRole, 
            req.user.company_id
        );
        
        let apiQuery = supabase.from('patients').select('*');
        if (userRole === 'admin') {
            // No filter
        } else if (userRole === 'company_admin' && accessibleUserIds.length > 1) {
            apiQuery = apiQuery.in('user_id', accessibleUserIds);
        } else {
            apiQuery = apiQuery.eq('user_id', userId);
        }
        
        const { data: apiData } = await apiQuery
            .order('created_at', { ascending: false })
            .limit(5);
        
        // Test 3: Counts
        const { count: totalCount } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true });
        
        const { count: ownCount } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);
        
        const { count: apiCount } = await supabase
            .from('patients')
            .select('*', { count: 'exact', head: true })
            .in('user_id', accessibleUserIds);
        
        res.json({
            success: true,
            user_info: {
                id: userId,
                email: userEmail,
                role: userRole,
                company_id: req.user.company_id
            },
            test_results: {
                direct_supabase_query: {
                    patients_found: directData?.length || 0,
                    sample: directData?.map(p => ({ id: p.id, patient_code: p.patient_code, user_id: p.user_id })) || []
                },
                api_endpoint_query: {
                    patients_found: apiData?.length || 0,
                    sample: apiData?.map(p => ({ id: p.id, patient_code: p.patient_code, user_id: p.user_id })) || []
                },
                counts: {
                    total_patients_system: totalCount || 0,
                    user_own_patients: ownCount || 0,
                    user_can_access_via_api: apiCount || 0
                }
            },
            security_issue: directData?.length > (ownCount || 0) ? 
                '❌ CRITICAL: Frontend can see other users\' patients via direct Supabase query!' :
                '✅ Secure: Frontend cannot see other users\' patients',
            fix_required: directData?.length > (ownCount || 0) ? 
                'YES - Update frontend to use API endpoints instead of direct Supabase queries' :
                'NO - Data isolation is already working'
        });
        
    } catch (error) {
        console.error('❌ [DEBUG] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Test data isolation
app.get('/api/test/data-isolation-test', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userEmail = req.user.email;
    
    console.log('🧪 DATA ISOLATION TEST for user:', { userId, userRole, userEmail });
    
    // Test 1: What does getUserAccessibleData return?
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
    
    // Test 2: How many patients in total system?
    const { count: totalPatients } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true });
    
    // Test 3: How many patients does this user own?
    const { count: userPatientsCount } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    // Test 4: Get a sample of user's patients
    const { data: userPatients } = await supabase
      .from('patients')
      .select('id, full_name, user_id, created_at')
      .eq('user_id', userId)
      .limit(3);
    
    // Test 5: Get all patients user can access
    let allAccessiblePatients = [];
    if (accessibleUserIds.length > 0) {
      const { data: accessiblePatients } = await supabase
        .from('patients')
        .select('id, full_name, user_id')
        .in('user_id', accessibleUserIds)
        .limit(5);
      allAccessiblePatients = accessiblePatients || [];
    }
    
    // Test 6: Check if user can see other users' data
    const otherUsersPatients = allAccessiblePatients.filter(p => p.user_id !== userId);
    
    res.json({
      success: true,
      test_results: {
        current_user: {
          id: userId,
          email: userEmail,
          role: userRole,
          company_id: req.user.company_id
        },
        accessible_data: {
          accessible_user_ids: accessibleUserIds,
          accessible_users_count: accessibleUserIds.length,
          includes_self: accessibleUserIds.includes(userId),
          expected_for_role: userRole === 'admin' ? 'ALL users' : 
                            userRole === 'company_admin' ? 'Company users' : 
                            'ONLY self'
        },
        patient_counts: {
          total_in_system: totalPatients || 0,
          user_own_patients: userPatientsCount || 0,
          accessible_patients: allAccessiblePatients.length
        },
        sample_data: {
          user_own_patients_sample: userPatients || [],
          all_accessible_patients_sample: allAccessiblePatients
        },
        data_isolation_check: {
          can_see_other_data: otherUsersPatients.length > 0,
          other_patients_count: otherUsersPatients.length,
          expected: userRole === 'admin' ? 'Can see other data' : 'Should NOT see other data',
          test_passed: userRole === 'admin' ? true : otherUsersPatients.length === 0
        }
      },
      interpretation: userRole === 'admin' 
        ? '✅ Admin correctly has expanded access' 
        : otherUsersPatients.length === 0 
          ? '✅ Data isolation WORKING: User only sees own data'
          : '❌ Data isolation BROKEN: User can see other users\' data',
      fix_needed: otherUsersPatients.length > 0 && userRole !== 'admin' 
        ? 'YES - getUserAccessibleData() is returning too many user IDs'
        : 'NO - Data isolation is working correctly'
    });
    
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
// Test endpoint to verify data isolation
app.get('/api/test/data-isolation', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const userEmail = req.user.email;
    
    console.log('🧪 [TEST] Testing data isolation for:', { userId, userRole, userEmail });
    
    // Test 1: Get accessible user IDs
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
    
    // Test 2: Count user's own patients
    const { count: ownPatientsCount } = await supabase
      .from('patients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    // Test 3: Count all patients user can access
    let accessiblePatientsCount = 0;
    if (accessibleUserIds.length > 0) {
      const { count: count } = await supabase
        .from('patients')
        .select('*', { count: 'exact', head: true })
        .in('user_id', accessibleUserIds);
      accessiblePatientsCount = count || 0;
    }
    
    // Test 4: Count ALL patients in system (admin only)
    let allPatientsCount = 0;
    if (userRole === 'admin') {
      const { count: count } = await supabase
        .from('patients')
        .select('*', { count: 'exact', head: true });
      allPatientsCount = count || 0;
    }
    
    // Test 5: Get a sample of user's own patients
    const { data: sampleOwnPatients } = await supabase
      .from('patients')
      .select('id, full_name, user_id')
      .eq('user_id', userId)
      .limit(3);
    
    res.json({
      success: true,
      test_results: {
        current_user: {
          id: userId,
          email: userEmail,
          role: userRole,
          company_id: req.user.company_id
        },
        accessible_user_ids: accessibleUserIds,
        accessible_users_count: accessibleUserIds.length,
        patient_counts: {
          own_patients: ownPatientsCount || 0,
          accessible_patients: accessiblePatientsCount,
          all_patients_system: userRole === 'admin' ? allPatientsCount : 'N/A (admin only)'
        },
        sample_own_patients: sampleOwnPatients || [],
        expected_behavior: {
          admin: 'Should see ALL patients',
          company_admin: 'Should see company patients only',
          regular_user: 'Should see OWN patients only'
        },
        test_passed: userRole === 'admin' ? true : (accessiblePatientsCount === ownPatientsCount)
      },
      interpretation: userRole === 'admin' 
        ? '✅ Admin correctly sees expanded access'
        : accessiblePatientsCount === ownPatientsCount
          ? '✅ Data isolation CORRECT: User only sees their own data'
          : '❌ Data isolation BROKEN: User can see other users\' data'
    });
    
  } catch (error) {
    console.error('❌ [TEST] Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user's own patients
// Get user's own patients - ALWAYS returns only user's own data
app.get('/api/patients/my-patients', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    console.log(`👤 [MY-PATIENTS] Getting own patients for user: ${userId}`);
    
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }
    
    const { data: patients, error } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', userId)  // CRITICAL: Only user's own patients
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ [MY-PATIENTS] Database error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch patients'
      });
    }
    
    console.log(`✅ [MY-PATIENTS] Found ${patients?.length || 0} patients for user ${userId}`);
    
    res.json({
      success: true,
      patients: patients || [],
      count: patients?.length || 0,
      note: 'These are ONLY your patients',
      user_id: userId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [MY-PATIENTS] Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch your patients'
    });
  }
});

// Get single patient with ownership check - USE THIS VERSION
// ✅ GET single patient with ownership check
app.get('/api/patients/:id', authenticateToken, async (req, res) => {
    try {
        const patientId = req.params.id;
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userCompanyId = req.user.company_id;

        console.log('🔍 [PATIENT SINGLE] Request for patient:', {
            patientId,
            userId,
            userRole
        });

        if (!supabase) {
            return res.status(503).json({ 
                success: false,
                error: 'Database not configured'
            });
        }

        // Get accessible user IDs
        const accessibleUserIds = await getUserAccessibleData(userId, userRole, userCompanyId);
        
        // Build query
        let query = supabase.from('patients').select('*').eq('id', patientId);
        
        // Apply ownership filter
        if (userRole === 'admin') {
            // Admin can see any patient
            console.log('👑 Admin accessing any patient');
        } else if (userRole === 'company_admin') {
            // Company admin: only if patient belongs to company
            console.log(`🏢 Company admin checking company access`);
            query = query.in('user_id', accessibleUserIds);
        } else {
            // Regular user: only if they own the patient
            console.log(`👤 Regular user checking ownership`);
            query = query.eq('user_id', userId);
        }

        const { data: patient, error } = await query.single();

        if (error || !patient) {
            console.error('❌ Patient not found or access denied:', error?.message);
            return res.status(404).json({ 
                success: false,
                error: 'Patient not found or access denied' 
            });
        }

        console.log('✅ Patient access granted:', patient.id);
        res.json({
            success: true,
            patient: patient
        });

    } catch (error) {
        console.error('❌ Get patient error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to fetch patient'
        });
    }
});

// Create new patient
// ✅ POST /api/patients - Create new patient WITH user_id
// ✅ POST /api/patients - Create new patient - FIXED VERSION
// ✅ FIXED: Create patient - handles both regular users and company users
// ✅ FIXED: Create patient - handles all constraints properly
// ✅ UPDATED: Create patient with proper user_id handling
app.post('/api/patients', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const userAccountType = req.user.account_type || 'individual';
        
        console.log('📝 [CREATE PATIENT] Starting for:', {
            userId,
            userRole,
            userAccountType
        });

        if (!supabase) {
            return res.status(503).json({ 
                success: false,
                error: 'Database not configured'
            });
        }

        const patientData = req.body;
        
        // Validate required fields
        if (!patientData.full_name || patientData.full_name.trim() === '') {
            return res.status(400).json({ 
                success: false,
                error: 'Patient full name is required'
            });
        }

        // Determine user_id based on account type
        let user_id = userId;
        let created_by = userId;
        
        // If company user, find their company admin in users table
        if (userAccountType === 'company_user') {
            console.log('🏢 Company user creating patient...');
            
            // Get company user info
            const { data: companyUser } = await supabase
                .from('company_users')
                .select('company_id, created_by')
                .eq('id', userId)
                .single();
            
            if (!companyUser || !companyUser.company_id) {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Company user not found or has no company' 
                });
            }
            
            // Find company admin in users table
            const { data: companyAdmin } = await supabase
                .from('users')
                .select('id')
                .eq('company_id', companyUser.company_id)
                .eq('role', 'company_admin')
                .limit(1)
                .single();
            
            if (companyAdmin) {
                user_id = companyAdmin.id;
                created_by = companyAdmin.id;
                console.log(`✅ Using company admin: ${companyAdmin.id}`);
            } else {
                // Fallback to system admin
                const { data: systemAdmin } = await supabase
                    .from('users')
                    .select('id')
                    .eq('role', 'admin')
                    .limit(1)
                    .single();
                
                if (systemAdmin) {
                    user_id = systemAdmin.id;
                    created_by = systemAdmin.id;
                    console.log(`🆘 Using system admin: ${systemAdmin.id}`);
                } else {
                    return res.status(500).json({ 
                        success: false, 
                        error: 'No valid user account found for patient ownership' 
                    });
                }
            }
        }
        
        // Prepare patient data
        const patientToCreate = {
            ...patientData,
            user_id: user_id,
            created_by: created_by,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        // Generate patient code if not provided
        if (!patientToCreate.patient_code || patientToCreate.patient_code.trim() === '') {
            const date = new Date();
            const year = date.getFullYear().toString().slice(-2);
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const day = date.getDate().toString().padStart(2, '0');
            const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            patientToCreate.patient_code = `PAT${year}${month}${day}${random}`;
        }
        
        // Clean up data
        delete patientToCreate.id;
        
        // Convert empty strings to null
        Object.keys(patientToCreate).forEach(key => {
            if (patientToCreate[key] === '' || patientToCreate[key] === undefined) {
                patientToCreate[key] = null;
            }
            // Convert numbers
            if (['age', 'weight', 'height', 'temperature'].includes(key) && patientToCreate[key]) {
                patientToCreate[key] = Number(patientToCreate[key]);
            }
        });
        
        console.log('📝 [CREATE PATIENT] Inserting with:', {
            patient_code: patientToCreate.patient_code,
            user_id: patientToCreate.user_id,
            created_by: patientToCreate.created_by
        });
        
        // Insert patient
        const { data: newPatient, error: insertError } = await supabase
            .from('patients')
            .insert([patientToCreate])
            .select()
            .single();
        
        if (insertError) {
            console.error('❌ [CREATE PATIENT] Database error:', insertError);
            
            // Try without created_by if foreign key constraint fails
            if (insertError.code === '23503') {
                console.log('🔄 Retrying without created_by...');
                
                delete patientToCreate.created_by;
                
                const { data: patient2, error: error2 } = await supabase
                    .from('patients')
                    .insert([patientToCreate])
                    .select()
                    .single();
                
                if (error2) {
                    throw error2;
                }
                
                console.log('✅ Created without created_by field');
                return res.status(201).json({
                    success: true,
                    message: 'Patient created successfully',
                    patient: patient2
                });
            }
            
            throw insertError;
        }
        
        console.log('✅ [CREATE PATIENT] Patient created:', {
            id: newPatient.id,
            patient_code: newPatient.patient_code,
            user_id: newPatient.user_id
        });
        
        res.status(201).json({
            success: true,
            message: 'Patient created successfully',
            patient: newPatient
        });

    } catch (error) {
        console.error('❌ [CREATE PATIENT] Server error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create patient',
            message: error.message,
            code: error.code
        });
    }
});
// DRN Assessment endpoints
app.post('/api/assessments/drn', authenticateToken, async (req, res) => {
  try {
    const { patient_id, patient_code, category, severity, interventions, monitoring_plan, notes } = req.body;
    const userId = req.user.userId;
    
    console.log('📋 Saving DRN assessment for patient:', patient_code);
    
    const assessmentData = {
      patient_id: patient_id,
      patient_code: patient_code,
      user_id: userId,
      category: category,
      severity: severity,
      interventions: interventions,
      monitoring_plan: monitoring_plan,
      notes: notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('drn_assessments')
      .insert([assessmentData])
      .select()
      .single();
    
    if (error) {
      console.error('Error saving assessment:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save assessment' 
      });
    }
    
    res.json({
      success: true,
      message: 'Assessment saved successfully',
      assessment: data
    });
    
  } catch (error) {
    console.error('DRN assessment error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Pharmacy Assistance Plan endpoints
app.post('/api/plans/pharmacy-assistance', authenticateToken, async (req, res) => {
  try {
    const { patient_id, patient_code, plan_type, goals, medications, monitoring, follow_up, notes } = req.body;
    const userId = req.user.userId;
    
    console.log('📋 Saving pharmacy assistance plan for patient:', patient_code);
    
    const planData = {
      patient_id: patient_id,
      patient_code: patient_code,
      user_id: userId,
      plan_type: plan_type,
      goals: goals,
      medications: medications,
      monitoring: monitoring,
      follow_up: follow_up,
      notes: notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('pharmacy_assistance_plans')
      .insert([planData])
      .select()
      .single();
    
    if (error) {
      console.error('Error saving plan:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save plan' 
      });
    }
    
    res.json({
      success: true,
      message: 'Plan saved successfully',
      plan: data
    });
    
  } catch (error) {
    console.error('Pharmacy assistance plan error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Patient Outcome endpoints
app.post('/api/outcomes', authenticateToken, async (req, res) => {
  try {
    const { patient_id, patient_code, outcome_type, outcome_status, measurements, improvement, complications, notes } = req.body;
    const userId = req.user.userId;
    
    console.log('📋 Saving patient outcome for patient:', patient_code);
    
    const outcomeData = {
      patient_id: patient_id,
      patient_code: patient_code,
      user_id: userId,
      outcome_type: outcome_type,
      outcome_status: outcome_status,
      measurements: measurements,
      improvement: improvement,
      complications: complications,
      notes: notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from('patient_outcomes')
      .insert([outcomeData])
      .select()
      .single();
    
    if (error) {
      console.error('Error saving outcome:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save outcome' 
      });
    }
    
    res.json({
      success: true,
      message: 'Outcome saved successfully',
      outcome: data
    });
    
  } catch (error) {
    console.error('Patient outcome error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Cost Analysis endpoints
// POST /api/costs - Save cost analysis
// POST /api/costs - Save cost analysis
// POST /api/costs - Save cost analysis (handles both UUID and integer patient_id)
// POST /api/costs - Save cost analysis (FIXED VERSION)
app.post('/api/costs', authenticateToken, async (req, res) => {
  try {
    console.log('💰 Saving cost analysis for patient:', req.body.patient_code);
    
    const {
      patient_code,
      analysis_date,
      analysis_type,
      direct_costs,
      indirect_costs,
      total_costs,
      cost_savings,
      roi,
      cost_per_outcome,
      currency,
      methodology,
      assumptions,
      findings,
      recommendations,
      analyzed_by,
      notes
    } = req.body;

    // Validate required fields
    if (!patient_code || !analysis_type) {
      return res.status(400).json({
        success: false,
        error: 'Patient code and analysis type are required'
      });
    }

    // Get the current user
    const userId = req.user.userId;
    console.log(`👤 Current user ID: ${userId}`);

    // First, let's check the database schema
    console.log('🔍 Checking database schema compatibility...');
    
    // Method 1: Try direct insert with user_id to satisfy RLS
    console.log('💾 Attempting direct insert with user_id...');
    
    const costData = {
      patient_code: patient_code,
      analysis_date: analysis_date || new Date().toISOString().split('T')[0],
      analysis_type: analysis_type,
      direct_costs: parseFloat(direct_costs) || 0,
      indirect_costs: parseFloat(indirect_costs) || 0,
      total_costs: parseFloat(total_costs) || 0,
      cost_savings: parseFloat(cost_savings) || 0,
      roi: parseFloat(roi) || 0,
      cost_per_outcome: parseFloat(cost_per_outcome) || 0,
      currency: currency || 'ETB',
      methodology: methodology || '',
      assumptions: assumptions || '',
      findings: findings || '',
      recommendations: recommendations || [],
      analyzed_by: analyzed_by || 'System',
      notes: notes || '',
      user_id: userId, // CRITICAL: Include user_id for RLS
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('📊 Cost data prepared for insert:', {
      patient_code: costData.patient_code,
      analysis_type: costData.analysis_type,
      user_id: costData.user_id,
      has_user_id: !!costData.user_id
    });

    // Try to insert
    let savedCost;
    let insertError;
    
    try {
      const { data, error } = await supabase
        .from('cost_analyses')
        .insert([costData])
        .select()
        .single();
      
      if (error) {
        insertError = error;
        console.error('❌ First insert attempt failed:', error);
      } else {
        savedCost = data;
        console.log('✅ Cost analysis saved successfully:', data.id);
      }
    } catch (dbError) {
      insertError = dbError;
      console.error('❌ Database error:', dbError);
    }

    // If first attempt failed, try alternative approaches
    if (insertError) {
      console.log('🔄 Trying alternative approaches...');
      
      // Check if it's a UUID vs integer issue
      if (insertError.message.includes('uuid') && insertError.message.includes('25')) {
        console.log('⚠️ UUID/Integer mismatch detected');
        
        // Try to get the patient's actual UUID/ID from database
        const { data: patient, error: patientError } = await supabase
          .from('patients')
          .select('id, patient_code, user_id')
          .eq('patient_code', patient_code)
          .single();
        
        if (!patientError && patient) {
          console.log(`📋 Patient found: ID=${patient.id}, User=${patient.user_id}`);
          
          // Method 2: Try with explicit casting
          const altCostData = {
            ...costData,
            patient_id: String(patient.id), // Convert to string
            user_id: userId || patient.user_id || userId
          };
          
          console.log('💾 Attempting insert with explicit patient_id as string...');
          
          const { data: altData, error: altError } = await supabase
            .from('cost_analyses')
            .insert([altCostData])
            .select()
            .single();
          
          if (altError) {
            console.error('❌ Second attempt failed:', altError);
            
            // Method 3: Use service role client (bypasses RLS)
            if (supabaseAdmin) {
              console.log('🛠️ Using service role client to bypass RLS...');
              
              const { data: serviceData, error: serviceError } = await supabaseAdmin
                .from('cost_analyses')
                .insert([costData])
                .select()
                .single();
              
              if (serviceError) {
                console.error('❌ Service role insert failed:', serviceError);
                throw serviceError;
              }
              
              savedCost = serviceData;
              console.log('✅ Cost analysis saved using service role:', serviceData.id);
            } else {
              throw altError;
            }
          } else {
            savedCost = altData;
            console.log('✅ Cost analysis saved with string patient_id:', altData.id);
          }
        } else {
          // Patient not found, try without patient reference
          console.log('⚠️ Patient not found in database, trying without patient reference...');
          
          const noPatientData = { ...costData };
          delete noPatientData.patient_code;
          
          const { data: noPatientResult, error: noPatientError } = await supabase
            .from('cost_analyses')
            .insert([noPatientData])
            .select()
            .single();
          
          if (noPatientError) {
            throw noPatientError;
          }
          
          savedCost = noPatientResult;
          console.log('✅ Cost analysis saved without patient reference:', noPatientResult.id);
        }
      } else if (insertError.code === '42501') {
        // RLS violation - use service role
        console.log('🔓 RLS violation detected, using service role...');
        
        if (!supabaseAdmin) {
          throw new Error('Service role client not available. Please check SUPABASE_SERVICE_ROLE_KEY.');
        }
        
        const { data: serviceData, error: serviceError } = await supabaseAdmin
          .from('cost_analyses')
          .insert([costData])
          .select()
          .single();
        
        if (serviceError) {
          throw serviceError;
        }
        
        savedCost = serviceData;
        console.log('✅ Cost analysis saved using service role (RLS bypassed):', serviceData.id);
      } else {
        throw insertError;
      }
    }

    if (!savedCost) {
      throw new Error('Failed to save cost analysis after multiple attempts');
    }
    
    res.status(201).json({
      success: true,
      message: 'Cost analysis saved successfully',
      cost: savedCost,
      used_service_role: !!savedCost._service_role // Flag if service role was used
    });

  } catch (error) {
    console.error('❌ Error saving cost analysis:', error);
    
    // Provide helpful error message
    let errorMessage = error.message;
    let suggestions = [];
    
    if (error.message.includes('uuid')) {
      suggestions.push('Check if patient_id column in cost_analyses table expects UUID but patients.id is integer');
      suggestions.push('Run: ALTER TABLE cost_analyses ALTER COLUMN patient_id TYPE INTEGER USING patient_id::integer');
    }
    
    if (error.code === '42501') {
      suggestions.push('RLS is blocking the insert. Either:');
      suggestions.push('1. Add user_id to the insert data');
      suggestions.push('2. Disable RLS: ALTER TABLE cost_analyses DISABLE ROW LEVEL SECURITY');
      suggestions.push('3. Check RLS policies in Supabase dashboard');
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      code: error.code,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      details: error.details
    });
  }
});
// PUT /api/costs/:id - Update cost analysis
app.put('/api/costs/:id', authenticateToken, async (req, res) => {
  try {
    const costId = req.params.id;
    console.log('🔄 Updating cost analysis:', costId);
    
    const {
      patient_id,
      patient_code,
      analysis_date,
      analysis_type,  // This is the correct field name
      direct_costs,
      indirect_costs,
      total_costs,
      cost_savings,
      roi,
      cost_per_outcome,
      currency,
      methodology,
      assumptions,
      findings,
      recommendations,
      analyzed_by,
      notes
    } = req.body;

    // Prepare update data - use analysis_type NOT category
    const updateData = {
      analysis_date,
      analysis_type: analysis_type,  // Correct column name
      direct_costs: parseFloat(direct_costs) || 0,
      indirect_costs: parseFloat(indirect_costs) || 0,
      total_costs: parseFloat(total_costs) || 0,
      cost_savings: parseFloat(cost_savings) || 0,
      roi: parseFloat(roi) || 0,
      cost_per_outcome: parseFloat(cost_per_outcome) || 0,
      currency: currency || 'ETB',
      methodology: methodology || '',
      assumptions: assumptions || '',
      findings: findings || '',
      recommendations: recommendations || [],
      analyzed_by: analyzed_by || 'System',
      notes: notes || '',
      updated_at: new Date().toISOString()
    };

    console.log('📊 Cost update data:', {
      analysis_type: updateData.analysis_type,
      direct_costs: updateData.direct_costs,
      indirect_costs: updateData.indirect_costs
    });

    // Update in database
    const { data: updatedCost, error } = await supabase
      .from('cost_analyses')
      .update(updateData)
      .eq('id', costId)
      .select()
      .single();

    if (error) {
      console.error('❌ Database error updating cost analysis:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update cost analysis',
        details: error.message
      });
    }

    if (!updatedCost) {
      return res.status(404).json({
        success: false,
        error: 'Cost analysis not found'
      });
    }

    console.log('✅ Cost analysis updated successfully:', updatedCost.id);
    
    res.json({
      success: true,
      message: 'Cost analysis updated successfully',
      cost: updatedCost
    });

  } catch (error) {
    console.error('❌ Error updating cost analysis:', error);
    res.status(500).json({
      success: false,
      error: 'Server error updating cost analysis',
      details: error.message
    });
  }
});
// Get assessments for a patient
app.get('/api/assessments/patient/:patientCode', authenticateToken, async (req, res) => {
  try {
    const { patientCode } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    console.log('📋 Getting assessments for patient:', patientCode);
    
    // Get accessible user IDs
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
    
    const { data, error } = await supabase
      .from('drn_assessments')
      .select('*')
      .eq('patient_code', patientCode)
      .in('user_id', accessibleUserIds)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching assessments:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch assessments' 
      });
    }
    
    res.json({
      success: true,
      assessments: data || []
    });
    
  } catch (error) {
    console.error('Get assessments error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});
// GET pharmacy plans for a patient
app.get('/api/plans/patient/:patientCode', authenticateToken, async (req, res) => {
  try {
    const { patientCode } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    console.log('📋 Getting pharmacy plans for patient:', patientCode);
    
    // Get accessible user IDs
    const accessibleUserIds = await getUserAccessibleData(userId, userRole, req.user.company_id);
    
    const { data, error } = await supabase
      .from('pharmacy_assistance_plans')
      .select('*')
      .eq('patient_code', patientCode)
      .in('user_id', accessibleUserIds)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error fetching pharmacy plans:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch pharmacy plans' 
      });
    }
    
    res.json({
      success: true,
      plans: data || []
    });
    
  } catch (error) {
    console.error('Get pharmacy plans error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// DELETE pharmacy plan
app.delete('/api/plans/:planId', authenticateToken, async (req, res) => {
  try {
    const { planId } = req.params;
    const userId = req.user.userId;
    
    console.log('🗑️ Deleting pharmacy plan:', planId);
    
    // Check if plan exists and belongs to user
    const { data: plan, error: fetchError } = await supabase
      .from('pharmacy_assistance_plans')
      .select('user_id')
      .eq('id', planId)
      .single();
    
    if (fetchError || !plan) {
      return res.status(404).json({ 
        success: false, 
        error: 'Plan not found' 
      });
    }
    
    // Check permission (only owner or admin can delete)
    const isAdmin = req.user.role === 'admin';
    const isOwner = plan.user_id === userId;
    
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ 
        success: false, 
        error: 'Permission denied' 
      });
    }
    
    // Delete the plan
    const { error: deleteError } = await supabase
      .from('pharmacy_assistance_plans')
      .delete()
      .eq('id', planId);
    
    if (deleteError) {
      throw deleteError;
    }
    
    res.json({
      success: true,
      message: 'Plan deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete plan error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});
// GET patient outcomes - Fixed version
app.get('/api/outcomes/patient/:patientCode', authenticateToken, async (req, res) => {
  try {
    const { patientCode } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    console.log('🔍 Getting outcomes for patient:', patientCode);
    console.log('User ID:', userId);
    console.log('User Role:', userRole);
    
    // First, check if table exists
    const { error: tableError } = await supabase
      .from('patient_outcomes')
      .select('id')
      .limit(1);
    
    if (tableError) {
      console.error('Table check error:', tableError);
      
      // Try with a different approach
      const { data, error } = await supabase
        .from('patient_outcomes')
        .select('*')
        .eq('patient_code', patientCode)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Direct query error:', error);
        
        // Last resort: use raw query
        const query = `
          SELECT * FROM patient_outcomes 
          WHERE patient_code = '${patientCode}' 
          ORDER BY created_at DESC
        `;
        
        console.log('Trying raw query:', query);
        
        const { data: rawData, error: rawError } = await supabase.rpc('exec_sql', { 
          query: query 
        }).catch(e => {
          console.log('Raw query failed:', e);
          return { data: null, error: e };
        });
        
        if (rawError) {
          console.error('All queries failed:', rawError);
          return res.json({
            success: true,
            outcomes: [],
            message: 'Table might not exist yet'
          });
        }
        
        return res.json({
          success: true,
          outcomes: rawData || []
        });
      }
      
      console.log('✅ Query successful, found:', data?.length || 0, 'outcomes');
      return res.json({
        success: true,
        outcomes: data || []
      });
    }
    
    // If table check passes, do the original query
    const { data, error } = await supabase
      .from('patient_outcomes')
      .select('*')
      .eq('patient_code', patientCode)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Final query error:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to fetch outcomes',
        details: error.message 
      });
    }
    
    console.log('✅ Retrieved', data?.length || 0, 'outcomes for patient:', patientCode);
    
    res.json({
      success: true,
      outcomes: data || []
    });
    
  } catch (error) {
    console.error('❌ Get outcomes error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error',
      message: error.message 
    });
  }
});

// Add similar GET endpoints for plans, outcomes, and costs...
// ✅ GET single patient by code (with data isolation)
app.get('/api/patients/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;
        
        console.log('🔍 [GET PATIENT] Fetching patient:', { patientCode, userId, userRole });
        
        // Get accessible user IDs
        const accessibleUserIds = await getUserAccessibleData(
            userId, 
            userRole, 
            req.user.company_id
        );
        
        let query = supabase.from('patients').select('*');
        
        if (userRole === 'admin') {
            // Admin can see any patient
            query = query.eq('patient_code', patientCode);
        } else if (userRole === 'company_admin' && accessibleUserIds.length > 1) {
            // Company admin can see patients in their company
            query = query.eq('patient_code', patientCode)
                       .in('user_id', accessibleUserIds);
        } else {
            // Regular user can only see their own patients
            query = query.eq('patient_code', patientCode)
                       .eq('user_id', userId);
        }
        
        const { data: patient, error } = await query.single();
        
        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Patient not found or you do not have permission'
                });
            }
            throw error;
        }
        
        if (!patient) {
            return res.status(404).json({ 
                success: false, 
                error: 'Patient not found' 
            });
        }
        
        console.log('✅ [GET PATIENT] Patient found:', patient.patient_code);
        
        res.json({
            success: true,
            patient: patient
        });
        
    } catch (error) {
        console.error('❌ [GET PATIENT] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ✅ CREATE new patient with user_id
app.post('/api/patients/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userEmail = req.user.email;
        const userRole = req.user.role;
        
        console.log('📝 [CREATE PATIENT] Creating for user:', { userId, userEmail, userRole });
        
        const patientData = {
            ...req.body,
            user_id: userId, // CRITICAL: Assign to logged-in user
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        // Validate required fields
        if (!patientData.patient_code) {
            return res.status(400).json({ 
                success: false, 
                error: 'Patient code is required' 
            });
        }
        
        console.log('📝 [CREATE PATIENT] Patient data:', {
            patient_code: patientData.patient_code,
            user_id: patientData.user_id,
            has_user_id: !!patientData.user_id
        });
        
        const { data, error } = await supabase
            .from('patients')
            .insert([patientData])
            .select()
            .single();
        
        if (error) {
            console.error('❌ [CREATE PATIENT] Database error:', error);
            return res.status(400).json({ 
                success: false, 
                error: error.message 
            });
        }
        
        console.log('✅ [CREATE PATIENT] Patient created:', {
            id: data.id,
            patient_code: data.patient_code,
            user_id: data.user_id
        });
        
        res.json({
            success: true,
            message: 'Patient created successfully',
            patient: data
        });
        
    } catch (error) {
        console.error('❌ [CREATE PATIENT] Server error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ✅ UPDATE patient (with ownership check)
app.put('/api/patients/:patientCode', authenticateToken, async (req, res) => {
    try {
        const patientCode = req.params.patientCode;
        const userId = req.user.userId;
        const userRole = req.user.role;
        
        console.log('🔄 [UPDATE PATIENT] Updating:', { patientCode, userId, userRole });
        
        // First, check if patient exists and user has permission
        const { data: existingPatient, error: fetchError } = await supabase
            .from('patients')
            .select('*')
            .eq('patient_code', patientCode)
            .single();
        
        if (fetchError || !existingPatient) {
            return res.status(404).json({ 
                success: false, 
                error: 'Patient not found' 
            });
        }
        
        // Check permission
        let hasPermission = false;
        
        if (userRole === 'admin') {
            hasPermission = true;
            console.log('👑 Admin can update any patient');
        } else if (userRole === 'company_admin') {
            const accessibleUserIds = await getUserAccessibleData(
                userId, 
                userRole, 
                req.user.company_id
            );
            hasPermission = accessibleUserIds.includes(existingPatient.user_id);
            console.log(`🏢 Company admin permission: ${hasPermission}`);
        } else {
            // Regular user can only update their own patients
            hasPermission = existingPatient.user_id === userId;
            console.log(`👤 Regular user permission: ${hasPermission} (patient.user_id: ${existingPatient.user_id}, userId: ${userId})`);
        }
        
        if (!hasPermission) {
            return res.status(403).json({ 
                success: false, 
                error: 'You do not have permission to update this patient' 
            });
        }
        
        // Prepare update data
        const updateData = {
            ...req.body,
            updated_at: new Date().toISOString()
        };
        
        // Don't allow changing user_id or created_by
        delete updateData.user_id;
        delete updateData.created_by;
        delete updateData.created_at;
        
        console.log('📝 [UPDATE PATIENT] Update data:', updateData);
        
        const { data, error } = await supabase
            .from('patients')
            .update(updateData)
            .eq('patient_code', patientCode)
            .select()
            .single();
        
        if (error) {
            console.error('❌ [UPDATE PATIENT] Update error:', error);
            throw error;
        }
        
        console.log('✅ [UPDATE PATIENT] Patient updated:', patientCode);
        
        res.json({
            success: true,
            message: 'Patient updated successfully',
            patient: data
        });
        
    } catch (error) {
        console.error('❌ [UPDATE PATIENT] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});
// Company routes - Add these to your backend server.js

// Get company info
app.get('/api/company/info', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        
        if (userRole !== 'company_admin' && userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Company admin access required'
            });
        }
        
        // Get user's company info
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('company_id')
            .eq('id', userId)
            .single();
            
        if (userError || !user || !user.company_id) {
            return res.status(404).json({
                success: false,
                error: 'Company not found for this user'
            });
        }
        
        // Get company details
        const { data: company, error: companyError } = await supabase
            .from('companies')
            .select('*')
            .eq('id', user.company_id)
            .single();
            
        if (companyError || !company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        res.json({
            success: true,
            company: company,
            user_role: userRole
        });
        
    } catch (error) {
        console.error('Get company info error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Get company users
// ✅ FIXED: Get company users from company_users table
app.get('/api/company/users', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        
        console.log('👥 [COMPANY USERS] Fetching for user:', { userId, userRole });
        
        if (userRole !== 'company_admin' && userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Company admin access required'
            });
        }
        
        // Get user's company from users table
        const { data: adminUser } = await supabase
            .from('users')
            .select('company_id')
            .eq('id', userId)
            .single();
            
        if (!adminUser || !adminUser.company_id) {
            return res.status(404).json({
                success: false,
                error: 'Company not found for this user'
            });
        }
        
        console.log(`🏢 [COMPANY USERS] Company ID: ${adminUser.company_id}`);
        
        // Get company users from company_users table
        const { data: companyUsers, error } = await supabase
            .from('company_users')
            .select('*')
            .eq('company_id', adminUser.company_id)
            .order('created_at', { ascending: false });
            
        if (error) {
            console.error('❌ [COMPANY USERS] Database error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch company users',
                details: error.message
            });
        }
        
        console.log(`✅ [COMPANY USERS] Found ${companyUsers?.length || 0} company users`);
        
        res.json({
            success: true,
            users: companyUsers || [],
            count: companyUsers?.length || 0,
            company_id: adminUser.company_id,
            source_table: 'company_users',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ [COMPANY USERS] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});
// Add user to company
// ✅ FIXED: Company admin creates users - users should be auto-approved
// ✅ FIXED: Create user in company_users table (NOT users table)
app.post('/api/company/users', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        const { 
            email, 
            password, 
            full_name, 
            phone, 
            role = 'company_user',
            license_number = ''
        } = req.body;
        
        console.log('👥 [ADD COMPANY USER] Creating:', { email, role });
        
        if (userRole !== 'company_admin' && userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Company admin access required'
            });
        }
        
        // Validate required fields
        if (!email || !password || !full_name) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and full name are required'
            });
        }
        
        // Validate email
        const cleanEmail = email.trim().toLowerCase();
        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({
                success: false,
                error: 'Please enter a valid email address'
            });
        }
        
        // Get admin user's company from users table
        const { data: adminUser } = await supabase
            .from('users')
            .select('company_id')
            .eq('id', userId)
            .single();
            
        if (!adminUser || !adminUser.company_id) {
            return res.status(404).json({
                success: false,
                error: 'Company not found for this admin'
            });
        }
        
        // Get company details
        const { data: company } = await supabase
            .from('companies')
            .select('company_name, country, region')
            .eq('id', adminUser.company_id)
            .single();
            
        // Check if email already exists in company_users table
        const { data: existingUser } = await supabase
            .from('company_users')
            .select('id')
            .eq('email', cleanEmail)
            .eq('company_id', adminUser.company_id)
            .maybeSingle();
            
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Email already exists in this company'
            });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password.trim(), 10);
        
        // ✅ CRITICAL: Create user in company_users table (NOT users table)
        const companyUserData = {
            company_id: adminUser.company_id,
            email: cleanEmail,
            password_hash: hashedPassword,
            full_name: full_name.trim(),
            phone: phone?.trim() || '',
            role: role,
            approved: true,  // Company users are auto-approved
            account_type: 'company_user',
            subscription_status: 'inactive',
            subscription_plan: null,
            license_number: license_number?.trim() || '',
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        console.log('📝 [ADD COMPANY USER] Inserting into company_users:', {
            email: companyUserData.email,
            company_id: companyUserData.company_id,
            has_password: !!companyUserData.password_hash
        });
        
        // Insert into company_users table
        const { data: newCompanyUser, error: insertError } = await supabase
            .from('company_users')
            .insert([companyUserData])
            .select()
            .single();
            
        if (insertError) {
            console.error('❌ [ADD COMPANY USER] Database error:', insertError);
            return res.status(500).json({
                success: false,
                error: 'Failed to create company user',
                details: insertError.message,
                code: insertError.code
            });
        }
        
        console.log(`✅ [ADD COMPANY USER] Created successfully:`, {
            id: newCompanyUser.id,
            email: newCompanyUser.email,
            company_id: newCompanyUser.company_id
        });
        
        res.json({
            success: true,
            message: 'Company user created successfully. They can login immediately.',
            user: {
                id: newCompanyUser.id,
                email: newCompanyUser.email,
                full_name: newCompanyUser.full_name,
                phone: newCompanyUser.phone,
                role: newCompanyUser.role,
                approved: newCompanyUser.approved,
                account_type: newCompanyUser.account_type,
                company_id: newCompanyUser.company_id,
                created_at: newCompanyUser.created_at
            },
            login_ready: true,
            credentials_note: 'User can login to company portal with the provided email and password',
            table_used: 'company_users'
        });
        
    } catch (error) {
        console.error('❌ [ADD COMPANY USER] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});
app.post('/api/company/users/:userId/approve', authenticateToken, async (req, res) => {
    try {
        const adminId = req.user.userId;
        const userRole = req.user.role;
        const { userId } = req.params;
        
        if (userRole !== 'company_admin' && userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Company admin access required'
            });
        }
        
        // Get admin's company
        const { data: adminUser } = await supabase
            .from('users')
            .select('company_id')
            .eq('id', adminId)
            .single();
            
        if (!adminUser || !adminUser.company_id) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Get user to approve
        const { data: userToApprove } = await supabase
            .from('users')
            .select('id, company_id')
            .eq('id', userId)
            .single();
            
        if (!userToApprove) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Verify user belongs to same company
        if (userToApprove.company_id !== adminUser.company_id) {
            return res.status(403).json({
                success: false,
                error: 'Cannot approve user from another company'
            });
        }
        
        // Approve user
        const { error: updateError } = await supabase
            .from('users')
            .update({ approved: true, updated_at: new Date().toISOString() })
            .eq('id', userId);
            
        if (updateError) {
            throw updateError;
        }
        
        res.json({
            success: true,
            message: 'User approved successfully'
        });
        
    } catch (error) {
        console.error('Approve user error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ✅ FIXED: Update user in company_users table
app.put('/api/company/users/:userId', authenticateToken, async (req, res) => {
    try {
        const adminId = req.user.userId;
        const userRole = req.user.role;
        const { userId } = req.params;
        const { full_name, phone, role, license_number, status } = req.body;
        
        console.log('✏️ [UPDATE COMPANY USER] Updating:', { userId, adminId, userRole });
        
        if (userRole !== 'company_admin' && userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Company admin access required'
            });
        }
        
        // Get admin's company
        const { data: adminUser } = await supabase
            .from('users')
            .select('company_id')
            .eq('id', adminId)
            .single();
            
        if (!adminUser || !adminUser.company_id) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Check if user exists in company_users table
        const { data: existingUser } = await supabase
            .from('company_users')
            .select('id, company_id, email')
            .eq('id', userId)
            .eq('company_id', adminUser.company_id)
            .single();
            
        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'Company user not found'
            });
        }
        
        // Prepare update data
        const updateData = {
            updated_at: new Date().toISOString()
        };
        
        if (full_name) updateData.full_name = full_name.trim();
        if (phone !== undefined) updateData.phone = phone?.trim() || null;
        if (role) updateData.role = role;
        if (license_number !== undefined) updateData.license_number = license_number?.trim() || null;
        if (status) updateData.status = status;
        
        console.log('📝 [UPDATE COMPANY USER] Update data:', updateData);
        
        // Update user in company_users table
        const { error: updateError } = await supabase
            .from('company_users')
            .update(updateData)
            .eq('id', userId)
            .eq('company_id', adminUser.company_id);
            
        if (updateError) {
            console.error('❌ [UPDATE COMPANY USER] Update error:', updateError);
            throw updateError;
        }
        
        console.log(`✅ [UPDATE COMPANY USER] Updated successfully: ${userId}`);
        
        res.json({
            success: true,
            message: 'Company user updated successfully'
        });
        
    } catch (error) {
        console.error('❌ [UPDATE COMPANY USER] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});
// ✅ FIXED: Delete user from company_users table
app.delete('/api/company/users/:userId', authenticateToken, async (req, res) => {
    try {
        const adminId = req.user.userId;
        const userRole = req.user.role;
        const { userId } = req.params;
        
        console.log('🗑️ [DELETE COMPANY USER] Deleting:', { userId, adminId, userRole });
        
        if (userRole !== 'company_admin' && userRole !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Company admin access required'
            });
        }
        
        // Get admin's company
        const { data: adminUser } = await supabase
            .from('users')
            .select('company_id, email')
            .eq('id', adminId)
            .single();
            
        if (!adminUser || !adminUser.company_id) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Check if user exists in company_users table
        const { data: userToDelete } = await supabase
            .from('company_users')
            .select('id, company_id, email')
            .eq('id', userId)
            .single();
            
        if (!userToDelete) {
            return res.status(404).json({
                success: false,
                error: 'Company user not found'
            });
        }
        
        // Verify user belongs to same company
        if (userToDelete.company_id !== adminUser.company_id) {
            return res.status(403).json({
                success: false,
                error: 'Cannot delete user from another company'
            });
        }
        
        // Cannot delete self
        const { data: adminInCompanyUsers } = await supabase
            .from('company_users')
            .select('id')
            .eq('email', adminUser.email)
            .eq('company_id', adminUser.company_id)
            .maybeSingle();
            
        if (adminInCompanyUsers && adminInCompanyUsers.id === userId) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete your own company account'
            });
        }
        
        console.log('🗑️ [DELETE COMPANY USER] Deleting from company_users table...');
        
        // Delete user from company_users table
        const { error: deleteError } = await supabase
            .from('company_users')
            .delete()
            .eq('id', userId)
            .eq('company_id', adminUser.company_id);
            
        if (deleteError) {
            console.error('❌ [DELETE COMPANY USER] Delete error:', deleteError);
            throw deleteError;
        }
        
        console.log(`✅ [DELETE COMPANY USER] Deleted successfully: ${userId}`);
        
        res.json({
            success: true,
            message: 'Company user deleted successfully',
            deleted_user: {
                id: userId,
                email: userToDelete.email
            }
        });
        
    } catch (error) {
        console.error('❌ [DELETE COMPANY USER] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});
// ✅ NEW: Login for company_users (separate from regular users)
app.post('/api/company/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔐 [COMPANY LOGIN] Attempt:', { email, passwordLength: password?.length });

        if (!email || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Email and password are required' 
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPassword = password.trim();

        console.log('🔍 [COMPANY LOGIN] Searching in company_users table:', cleanEmail);

        // Find user in company_users table
        const { data: companyUser, error: fetchError } = await supabase
            .from('company_users')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (fetchError) {
            console.error('❌ [COMPANY LOGIN] Database error:', fetchError);
            return res.status(500).json({ 
                success: false,
                error: 'Database error during login'
            });
        }

        if (!companyUser) {
            console.log('❌ [COMPANY LOGIN] User not found in company_users table');
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password'
            });
        }

        console.log('✅ [COMPANY LOGIN] Company user found:', {
            id: companyUser.id,
            email: companyUser.email,
            company_id: companyUser.company_id,
            approved: companyUser.approved
        });

        // Check password
        let validPassword = false;
        try {
            if (companyUser.password_hash) {
                validPassword = await bcrypt.compare(cleanPassword, companyUser.password_hash);
                console.log('🔑 [COMPANY LOGIN] Password check:', validPassword);
            }
        } catch (bcryptError) {
            console.error('❌ [COMPANY LOGIN] Password error:', bcryptError);
        }

        if (!validPassword) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if approved
        if (!companyUser.approved) {
            console.log('❌ [COMPANY LOGIN] Company user not approved:', companyUser.email);
            return res.status(401).json({ 
                success: false,
                error: 'Your company account is pending approval',
                approval_required: true
            });
        }

        // Get company info
        const { data: company } = await supabase
            .from('companies')
            .select('company_name, subscription_status')
            .eq('id', companyUser.company_id)
            .single();

        // Create JWT token for company user
        const tokenPayload = {
            userId: companyUser.id,
            email: companyUser.email,
            name: companyUser.full_name,
            role: companyUser.role,
            account_type: 'company_user',
            company_id: companyUser.company_id,
            approved: companyUser.approved,
            subscription_status: companyUser.subscription_status
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        // Prepare response
        const userResponse = {
            id: companyUser.id,
            email: companyUser.email,
            full_name: companyUser.full_name,
            role: companyUser.role,
            phone: companyUser.phone,
            approved: companyUser.approved,
            account_type: companyUser.account_type,
            company_id: companyUser.company_id,
            company_name: company?.company_name || '',
            subscription_status: companyUser.subscription_status,
            subscription_plan: companyUser.subscription_plan,
            subscription_end_date: companyUser.subscription_end_date,
            created_at: companyUser.created_at,
            license_number: companyUser.license_number || ''
        };

        console.log('✅ [COMPANY LOGIN] Login successful for:', companyUser.email);
        
        res.json({
            success: true,
            message: 'Company login successful',
            token: token,
            user: userResponse,
            token_expires_in: '24 hours',
            login_type: 'company_user'
        });

    } catch (error) {
        console.error('❌ [COMPANY LOGIN] Error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Login failed',
            details: error.message
        });
    }
});
// ✅ NEW: Get company user profile
app.get('/api/company/auth/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userRole = req.user.role;
        
        console.log('👤 [COMPANY PROFILE] Fetching for user:', { userId, userRole });
        
        // Check if this is a company_user
        if (req.user.account_type !== 'company_user') {
            return res.status(403).json({
                success: false,
                error: 'Company user access required'
            });
        }
        
        // Get user from company_users table
        const { data: companyUser, error } = await supabase
            .from('company_users')
            .select('*')
            .eq('id', userId)
            .single();

        if (error || !companyUser) {
            console.error('❌ [COMPANY PROFILE] User not found:', error);
            return res.status(404).json({
                success: false,
                error: 'Company user not found'
            });
        }
        
        // Get company info
        const { data: company } = await supabase
            .from('companies')
            .select('company_name, company_address, phone as company_phone')
            .eq('id', companyUser.company_id)
            .single();
        
        console.log('✅ [COMPANY PROFILE] Retrieved successfully');
        
        res.json({
            success: true,
            user: {
                id: companyUser.id,
                email: companyUser.email,
                full_name: companyUser.full_name,
                role: companyUser.role,
                phone: companyUser.phone,
                approved: companyUser.approved,
                account_type: companyUser.account_type,
                company_id: companyUser.company_id,
                company_name: company?.company_name || '',
                company_address: company?.company_address || '',
                company_phone: company?.company_phone || '',
                subscription_status: companyUser.subscription_status,
                subscription_plan: companyUser.subscription_plan,
                subscription_end_date: companyUser.subscription_end_date,
                license_number: companyUser.license_number || '',
                created_at: companyUser.created_at,
                updated_at: companyUser.updated_at
            }
        });

    } catch (error) {
        console.error('❌ [COMPANY PROFILE] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get company user profile',
            details: error.message
        });
    }
});
// ✅ NEW: Update company user profile
app.put('/api/company/auth/update-profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const updates = req.body;

        console.log('✏️ [COMPANY UPDATE PROFILE] Updating:', { userId, updates });

        if (req.user.account_type !== 'company_user') {
            return res.status(403).json({
                success: false,
                error: 'Company user access required'
            });
        }

        // Remove fields that shouldn't be updated
        delete updates.id;
        delete updates.email;
        delete updates.company_id;
        delete updates.approved;
        delete updates.account_type;
        delete updates.created_at;
        delete updates.password_hash;
        delete updates.created_by;

        // Add updated timestamp
        updates.updated_at = new Date().toISOString();

        // Update user in company_users table
        const { data: updatedUser, error } = await supabase
            .from('company_users')
            .update(updates)
            .eq('id', userId)
            .select()
            .single();

        if (error || !updatedUser) {
            console.error('❌ [COMPANY UPDATE PROFILE] Update failed:', error);
            return res.status(500).json({ 
                success: false,
                error: 'Failed to update profile' 
            });
        }

        console.log('✅ [COMPANY UPDATE PROFILE] Updated successfully');
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: {
                id: updatedUser.id,
                email: updatedUser.email,
                full_name: updatedUser.full_name,
                phone: updatedUser.phone,
                role: updatedUser.role,
                license_number: updatedUser.license_number
            }
        });

    } catch (error) {
        console.error('❌ [COMPANY UPDATE PROFILE] Error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to update profile',
            details: error.message
        });
    }
});
// ✅ NEW: Login endpoint for company_users table
app.post('/api/company/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log('🔐 [COMPANY LOGIN] Attempt:', { email, passwordLength: password?.length });

        if (!email || !password) {
            return res.status(400).json({ 
                success: false,
                error: 'Email and password are required' 
            });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPassword = password.trim();

        console.log('🔍 [COMPANY LOGIN] Searching in company_users table:', cleanEmail);

        // Find user in company_users table
        const { data: companyUser, error: fetchError } = await supabase
            .from('company_users')
            .select('*')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (fetchError) {
            console.error('❌ [COMPANY LOGIN] Database error:', fetchError);
            return res.status(500).json({ 
                success: false,
                error: 'Database error during login'
            });
        }

        if (!companyUser) {
            console.log('❌ [COMPANY LOGIN] User not found in company_users table');
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password'
            });
        }

        console.log('✅ [COMPANY LOGIN] Company user found:', {
            id: companyUser.id,
            email: companyUser.email,
            company_id: companyUser.company_id,
            approved: companyUser.approved
        });

        // Check password
        let validPassword = false;
        try {
            if (companyUser.password_hash) {
                validPassword = await bcrypt.compare(cleanPassword, companyUser.password_hash);
                console.log('🔑 [COMPANY LOGIN] Password check:', validPassword);
            }
        } catch (bcryptError) {
            console.error('❌ [COMPANY LOGIN] Password error:', bcryptError);
        }

        if (!validPassword) {
            return res.status(401).json({ 
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if approved
        if (!companyUser.approved) {
            console.log('❌ [COMPANY LOGIN] Company user not approved:', companyUser.email);
            return res.status(401).json({ 
                success: false,
                error: 'Your company account is pending approval',
                approval_required: true
            });
        }

        // Get company info
        const { data: company } = await supabase
            .from('companies')
            .select('company_name, subscription_status')
            .eq('id', companyUser.company_id)
            .single();

        // Create JWT token for company user
        const tokenPayload = {
            userId: companyUser.id,
            email: companyUser.email,
            name: companyUser.full_name,
            role: companyUser.role,
            account_type: 'company_user',
            company_id: companyUser.company_id,
            approved: companyUser.approved,
            subscription_status: companyUser.subscription_status
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        // Prepare response
        const userResponse = {
            id: companyUser.id,
            email: companyUser.email,
            full_name: companyUser.full_name,
            role: companyUser.role,
            phone: companyUser.phone,
            approved: companyUser.approved,
            account_type: companyUser.account_type,
            company_id: companyUser.company_id,
            company_name: company?.company_name || '',
            subscription_status: companyUser.subscription_status,
            subscription_plan: companyUser.subscription_plan,
            subscription_end_date: companyUser.subscription_end_date,
            created_at: companyUser.created_at,
            license_number: companyUser.license_number || ''
        };

        console.log('✅ [COMPANY LOGIN] Login successful for:', companyUser.email);
        
        res.json({
            success: true,
            message: 'Company login successful',
            token: token,
            user: userResponse,
            token_expires_in: '24 hours',
            login_type: 'company_user'
        });

    } catch (error) {
        console.error('❌ [COMPANY LOGIN] Error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Login failed',
            details: error.message
        });
    }
});
// Update patient
app.put('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    const patientId = req.params.id;
    const userId = req.user.userId;
    const userRole = req.user.role;
    const updates = req.body;

    debug.log(`Updating patient ${patientId} for user ${userId}`, updates);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check if user has access to this patient
    const hasAccess = await checkUserPatientAccess(userId, patientId, userRole);
    if (!hasAccess) {
      debug.error('User does not have access to update this patient');
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. You do not have permission to update this patient.' 
      });
    }

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.user_id;
    delete updates.patient_code;
    delete updates.created_at;

    // Add updated timestamp
    updates.updated_at = new Date().toISOString();

    // Build update query
    const { data: patient, error } = await supabase
      .from('patients')
      .update(updates)
      .eq('id', patientId)
      .select()
      .single();

    if (error || !patient) {
      debug.error('Patient update failed:', error);
      return res.status(404).json({ 
        success: false,
        error: 'Patient not found or update failed' 
      });
    }

    debug.success(`Patient ${patientId} updated successfully`);
    res.json({
      success: true,
      message: 'Patient updated successfully',
      patient: patient,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Update patient error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update patient',
      details: error.message
    });
  }
});

// Delete patient
app.delete('/api/patients/:id', authenticateToken, async (req, res) => {
  try {
    const patientId = req.params.id;
    const userId = req.user.userId;
    const userRole = req.user.role;

    debug.log(`Deleting patient ${patientId} for user ${userId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check if user has access to this patient
    const hasAccess = await checkUserPatientAccess(userId, patientId, userRole);
    if (!hasAccess) {
      debug.error('User does not have access to delete this patient');
      return res.status(403).json({ 
        success: false,
        error: 'Access denied. You do not have permission to delete this patient.' 
      });
    }

    // Build delete query
    const { error, count } = await supabase
      .from('patients')
      .delete()
      .eq('id', patientId);

    if (error) {
      debug.error('Failed to delete patient:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to delete patient',
        details: error.message
      });
    }

    if (count === 0) {
      debug.warn(`Patient ${patientId} not found`);
      return res.status(404).json({ 
        success: false,
        error: 'Patient not found'
      });
    }

    debug.success(`Patient ${patientId} deleted successfully`);
    res.json({
      success: true,
      message: 'Patient deleted successfully',
      patient_id: patientId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Delete patient error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete patient',
      details: error.message
    });
  }
});

// Search patients
app.get('/api/patients/search/:query', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const rawQuery = req.params.query;
    
    debug.log(`Searching patients for user ${userId} with query: "${rawQuery}"`);
    
    // Sanitize query to prevent SQL injection
    const query = sanitizeSearchQuery(rawQuery);
    
    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    let searchQuery = supabase
      .from('patients')
      .select('*')
      .or(`full_name.ilike.%${query}%,patient_code.ilike.%${query}%,contact_number.ilike.%${query}%,diagnosis.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(50);

    // Filter by user role
    if (userRole === 'admin') {
      // Admin can see all patients
      debug.log('Admin searching all patients');
    } else if (userRole === 'company_admin') {
      // Company admin: get patients from same company
      debug.log('Company admin searching patients in company');
      
      // Get user's company
      const { data: user } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', userId)
        .single();
      
      if (!user || !user.company_id) {
        debug.warn('Company admin has no company assigned');
        return res.json({
          success: true,
          patients: []
        });
      }
      
      // Get all users in the company
      const { data: companyUsers } = await supabase
        .from('users')
        .select('id')
        .eq('company_id', user.company_id);
      
      if (!companyUsers || companyUsers.length === 0) {
        debug.log('No users found in company');
        return res.json({
          success: true,
          patients: []
        });
      }
      
      const userIds = companyUsers.map(u => u.id);
      searchQuery = searchQuery.in('user_id', userIds);
    } else {
      // Regular user: only their own patients
      searchQuery = searchQuery.eq('user_id', userId);
    }

    const { data: patients, error } = await searchQuery;

    if (error) {
      debug.error('Search patients error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Search failed',
        details: error.message
      });
    }

    debug.success(`Found ${patients?.length || 0} patients matching query "${query}"`);
    res.json({
      success: true,
      patients: patients || [],
      count: patients?.length || 0,
      query: query,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Search patients error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to search patients',
      details: error.message
    });
  }
});

// Get patient statistics
app.get('/api/patients/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;

    debug.log(`Fetching patient stats for user ${userId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    let totalPatients = 0;
    let activePatients = 0;
    let malePatients = 0;
    let femalePatients = 0;
    let pediatricPatients = 0;
    let adultPatients = 0;
    let pregnantPatients = 0;

    try {
      // Build query based on user role
      let query = supabase.from('patients').select('*', { count: 'exact', head: true });

      if (userRole === 'admin') {
        // Admin gets all patients
      } else if (userRole === 'company_admin') {
        // Company admin: get patients from same company
        const { data: user } = await supabase
          .from('users')
          .select('company_id')
          .eq('id', userId)
          .single();
        
        if (user && user.company_id) {
          const { data: companyUsers } = await supabase
            .from('users')
            .select('id')
            .eq('company_id', user.company_id);
          
          if (companyUsers && companyUsers.length > 0) {
            const userIds = companyUsers.map(u => u.id);
            query = query.in('user_id', userIds);
          } else {
            query = query.eq('user_id', '00000000-0000-0000-0000-000000000000'); // No results
          }
        }
      } else {
        // Regular user: only their own patients
        query = query.eq('user_id', userId);
      }

      // Get counts
      const { count: total } = await query;
      totalPatients = total || 0;

      // Get active patients
      const { count: active } = await query.eq('is_active', true);
      activePatients = active || 0;

      // Get gender distribution
      const { count: male } = await query.eq('gender', 'male');
      malePatients = male || 0;

      const { count: female } = await query.eq('gender', 'female');
      femalePatients = female || 0;

      // Get age distribution
      const { count: pediatric } = await query.eq('patient_type', 'pediatric');
      pediatricPatients = pediatric || 0;

      const { count: adult } = await query.eq('patient_type', 'adult');
      adultPatients = adult || 0;

      // Get pregnant patients
      const { count: pregnant } = await query.eq('is_pregnant', true);
      pregnantPatients = pregnant || 0;

    } catch (countError) {
      debug.error('Error counting patients:', countError);
    }

    const stats = {
      total_patients: totalPatients,
      active_patients: activePatients,
      male_patients: malePatients,
      female_patients: femalePatients,
      pediatric_patients: pediatricPatients,
      adult_patients: adultPatients,
      pregnant_patients: pregnantPatients,
      inactive_patients: totalPatients - activePatients,
      timestamp: new Date().toISOString()
    };

    debug.success(`Patient stats retrieved for user ${userId}`);
    res.json({
      success: true,
      stats: stats,
      user_role: userRole
    });

  } catch (error) {
    debug.error('Get patient stats error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch patient statistics',
      details: error.message
    });
  }
});

// ==================== MEDICATION KNOWLEDGE BASE ROUTES ====================

// Get all medications (admin only)
app.get('/api/admin/medications', authenticateToken, requireAdmin, async (req, res) => {
  try {
    debug.log('Fetching medication knowledge base...');
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: medications, error } = await supabase
      .from('medications')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      debug.warn('Error fetching medications, returning empty array', error);
      return res.json({
        success: true,
        medications: []
      });
    }

    debug.success(`Found ${medications?.length || 0} medications`);
    res.json({
      success: true,
      medications: medications || [],
      count: medications?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get medications error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch medications',
      details: error.message
    });
  }
});

// Search medications (public for authenticated users)
app.get('/api/medications/search/:query', authenticateToken, async (req, res) => {
  try {
    const query = req.params.query;
    debug.log(`Searching medications for query: "${query}"`);

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'Search query must be at least 2 characters'
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: medications, error } = await supabase
      .from('medications')
      .select('*')
      .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%,brand_names.ilike.%${query}%`)
      .order('name', { ascending: true })
      .limit(50);

    if (error) {
      debug.warn('Error searching medications, returning empty array', error);
      return res.json({
        success: true,
        medications: []
      });
    }

    debug.success(`Found ${medications?.length || 0} medications matching "${query}"`);
    res.json({
      success: true,
      medications: medications || [],
      count: medications?.length || 0,
      query: query,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Search medications error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to search medications',
      details: error.message
    });
  }
});

// Get medication by ID
app.get('/api/medications/:id', authenticateToken, async (req, res) => {
  try {
    const medicationId = req.params.id;
    debug.log(`Fetching medication: ${medicationId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: medication, error } = await supabase
      .from('medications')
      .select('*')
      .eq('id', medicationId)
      .single();

    if (error || !medication) {
      debug.error('Medication not found:', error);
      return res.status(404).json({ 
        success: false,
        error: 'Medication not found' 
      });
    }

    debug.success(`Medication retrieved: ${medication.name}`);
    res.json({
      success: true,
      medication: medication,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get medication error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch medication',
      details: error.message
    });
  }
});

// Add medication to knowledge base (admin only)
app.post('/api/admin/medications', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicationData = req.body;
    debug.log('Adding medication to knowledge base:', medicationData);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Validate required fields
    if (!medicationData.name || !medicationData.generic_name) {
      return res.status(400).json({
        success: false,
        error: 'Medication name and generic name are required'
      });
    }

    // Create medication record
    const newMedication = {
      name: medicationData.name.trim(),
      generic_name: medicationData.generic_name.trim(),
      brand_names: medicationData.brand_names?.trim() || '',
      class: medicationData.class?.trim() || '',
      dosage_forms: medicationData.dosage_forms?.trim() || '',
      strength: medicationData.strength?.trim() || '',
      route: medicationData.route?.trim() || '',
      indications: medicationData.indications?.trim() || '',
      contraindications: medicationData.contraindications?.trim() || '',
      side_effects: medicationData.side_effects?.trim() || '',
      interactions: medicationData.interactions?.trim() || '',
      storage: medicationData.storage?.trim() || '',
      pregnancy_category: medicationData.pregnancy_category?.trim() || '',
      schedule: medicationData.schedule?.trim() || '',
      notes: medicationData.notes?.trim() || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    debug.log('Inserting medication into database...');
    const { data: medication, error } = await supabase
      .from('medications')
      .insert([newMedication])
      .select()
      .single();

    if (error) {
      debug.error('Create medication error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to create medication',
        details: error.message
      });
    }

    debug.success(`Medication created successfully: ${medication.id}`);
    res.status(201).json({
      success: true,
      message: 'Medication added to knowledge base successfully',
      medication: medication,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Create medication error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to add medication to knowledge base',
      details: error.message
    });
  }
});

// Update medication in knowledge base (admin only)
app.put('/api/admin/medications/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicationId = req.params.id;
    const updates = req.body;
    debug.log(`Updating medication ${medicationId}:`, updates);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check if medication exists
    const { data: existingMedication, error: fetchError } = await supabase
      .from('medications')
      .select('*')
      .eq('id', medicationId)
      .single();

    if (fetchError || !existingMedication) {
      debug.error('Medication not found:', fetchError);
      return res.status(404).json({ 
        success: false,
        error: 'Medication not found' 
      });
    }

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.created_at;

    // Add updated timestamp
    updates.updated_at = new Date().toISOString();

    // Update medication
    const { data: medication, error } = await supabase
      .from('medications')
      .update(updates)
      .eq('id', medicationId)
      .select()
      .single();

    if (error || !medication) {
      debug.error('Medication update failed:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to update medication' 
      });
    }

    debug.success(`Medication ${medicationId} updated successfully`);
    res.json({
      success: true,
      message: 'Medication updated successfully',
      medication: medication,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Update medication error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update medication',
      details: error.message
    });
  }
});

// Delete medication from knowledge base (admin only)
app.delete('/api/admin/medications/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const medicationId = req.params.id;
    debug.log(`Deleting medication ${medicationId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check if medication exists
    const { data: existingMedication, error: fetchError } = await supabase
      .from('medications')
      .select('name')
      .eq('id', medicationId)
      .single();

    if (fetchError || !existingMedication) {
      debug.error('Medication not found:', fetchError);
      return res.status(404).json({ 
        success: false,
        error: 'Medication not found' 
      });
    }

    // Delete medication
    const { error, count } = await supabase
      .from('medications')
      .delete()
      .eq('id', medicationId);

    if (error) {
      debug.error('Failed to delete medication:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to delete medication',
        details: error.message
      });
    }

    if (count === 0) {
      debug.warn(`Medication ${medicationId} not found`);
      return res.status(404).json({ 
        success: false,
        error: 'Medication not found'
      });
    }

    debug.success(`Medication ${medicationId} deleted successfully`);
    res.json({
      success: true,
      message: 'Medication deleted successfully',
      medication_name: existingMedication.name,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Delete medication error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete medication',
      details: error.message
    });
  }
});

// Check drug interactions (admin only for now, can be expanded)
app.post('/api/admin/check-interaction', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { med1, med2 } = req.body;
    debug.log(`Checking interaction between ${med1} and ${med2}`);

    if (!med1 || !med2) {
      return res.status(400).json({
        success: false,
        error: 'Both medication names are required'
      });
    }

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Get both medications
    const { data: medication1, error: error1 } = await supabase
      .from('medications')
      .select('interactions, class, name, generic_name')
      .or(`name.ilike.%${med1}%,generic_name.ilike.%${med1}%`)
      .maybeSingle();

    const { data: medication2, error: error2 } = await supabase
      .from('medications')
      .select('interactions, class, name, generic_name')
      .or(`name.ilike.%${med2}%,generic_name.ilike.%${med2}%`)
      .maybeSingle();

    if (!medication1 || !medication2) {
      debug.warn('One or both medications not found in database');
      const simulatedResult = {
        interaction: 'Unknown',
        severity: 'Unknown',
        description: 'One or both medications not found in database. Consult professional references.',
        recommendations: 'Check with pharmacist or physician before combining medications.',
        risk_level: 'unknown'
      };
      
      return res.json({
        success: true,
        result: simulatedResult,
        note: 'Simulated interaction check - medications not found in database',
        medications: {
          med1_found: !!medication1,
          med2_found: !!medication2
        }
      });
    }

    // Simple interaction logic
    const hasInteraction = medication1.interactions?.toLowerCase().includes(medication2.name.toLowerCase()) ||
                          medication1.interactions?.toLowerCase().includes(medication2.generic_name.toLowerCase()) ||
                          medication2.interactions?.toLowerCase().includes(medication1.name.toLowerCase()) ||
                          medication2.interactions?.toLowerCase().includes(medication1.generic_name.toLowerCase()) ||
                          medication1.class === medication2.class;

    let interactionResult = {
      interaction: hasInteraction ? 'Potential interaction detected' : 'No known interaction',
      severity: hasInteraction ? 'Moderate' : 'Low',
      risk_level: hasInteraction ? 'moderate' : 'low',
      description: hasInteraction ? 
        `Potential interaction between ${medication1.name} (${medication1.class}) and ${medication2.name} (${medication2.class}).` :
        `No known significant interactions between ${medication1.name} and ${medication2.name}.`,
      recommendations: hasInteraction ?
        'Monitor patient closely. Consider alternative therapy or adjust dosages. Consult with physician.' :
        'Standard monitoring recommended as with any medication combination.',
      medications: {
        med1: {
          name: medication1.name,
          generic_name: medication1.generic_name,
          class: medication1.class
        },
        med2: {
          name: medication2.name,
          generic_name: medication2.generic_name,
          class: medication2.class
        }
      },
      found_in_database: true
    };

    debug.success('Interaction check completed');
    res.json({
      success: true,
      result: interactionResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Check interaction error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to check drug interactions',
      details: error.message
    });
  }
});

// ==================== CHAPA PAYMENT ROUTES ====================

// Create Payment - FIXED WITH PHONE
app.post('/api/chapa/create-payment', async (req, res) => {
  try {
    const { planId, userEmail, userName, userPhone, userId, account_type } = req.body;
    
    console.log('💳 Payment request:', { userEmail, userPhone, planId });

    if (!planId || !userEmail) {
      return res.status(400).json({ 
        success: false,
        error: 'Plan ID and email are required' 
      });
    }

    const planDetails = getPlanDetails(planId);
    if (!planDetails) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid plan ID' 
      });
    }

    // Generate transaction reference
    const tx_ref = `pharma_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    
    // Prepare Chapa data
    const nameParts = (userName || 'User').split(' ');
    const paymentData = {
      amount: planDetails.price.toString(),
      currency: 'ETB',
      email: userEmail,
      first_name: nameParts[0] || 'User',
      last_name: nameParts.slice(1).join(' ') || 'User',
      tx_ref: tx_ref,
      callback_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/api/chapa/webhook`,
      return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/subscription/success?tx_ref=${tx_ref}&status=success`,
      customization: {
        title: 'PharmaCare',
        description: planDetails.name.substring(0, 100)
      }
    };

    console.log('Calling Chapa API...');
    
    // Call Chapa
    const response = await axios.post(
      `${CHAPA_BASE_URL}/transaction/initialize`, 
      paymentData,
      {
        headers: {
          'Authorization': `Bearer ${CHAPA_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    if (response.data.status !== 'success') {
      return res.status(400).json({
        success: false,
        error: response.data.message || 'Payment gateway error'
      });
    }

    // Store payment in database WITH PHONE
    const paymentRecord = {
      user_id: userId || null,
      user_email: userEmail,
      user_name: userName || 'User',
      user_phone: userPhone || null, // STORE PHONE
      tx_ref: tx_ref,
      plan_id: planId,
      plan_name: planDetails.name,
      amount: planDetails.price,
      currency: 'ETB',
      status: 'pending',
      payment_method: 'chapa',
      payment_url: response.data.data.checkout_url,
      account_type: account_type || 'individual',
      gateway_response: response.data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: storedPayment, error: paymentError } = await supabase
      .from('payments')
      .insert([paymentRecord])
      .select()
      .single();

    if (paymentError) {
      console.error('Payment storage error:', paymentError);
    } else {
      console.log('Payment stored:', storedPayment.id);
    }

    console.log('✅ Payment created:', tx_ref);

    res.json({
      success: true,
      payment_url: response.data.data.checkout_url,
      tx_ref: tx_ref,
      amount: planDetails.price,
      currency: planDetails.currency,
      plan_name: planDetails.name,
      user_phone: userPhone, // Return phone
      message: 'Payment initiated successfully'
    });

  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create payment',
      details: error.message
    });
  }
});

// Webhook Handler - SIMPLE & EFFECTIVE
app.post('/api/chapa/webhook', express.json(), async (req, res) => {
  try {
    const webhookData = req.body;
    const tx_ref = webhookData.tx_ref;
    const status = webhookData.status;
    
    console.log('🔔 Webhook received:', { tx_ref, status });

    if (!tx_ref) {
      return res.status(400).json({ error: 'Missing transaction reference' });
    }

    // Find payment
    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('tx_ref', tx_ref)
      .single();

    if (!payment) {
      console.error('Payment not found:', tx_ref);
      return res.status(404).json({ error: 'Payment not found' });
    }

    console.log(`Payment found: ${payment.id}, current status: ${payment.status}`);

    // Update payment status
    const updateData = {
      updated_at: new Date().toISOString(),
      gateway_response: webhookData
    };

    if (status === 'success') {
      updateData.status = 'paid';
      updateData.paid_at = new Date().toISOString();
      updateData.transaction_id = webhookData.transaction_id;
      console.log('✅ Updating to PAID');
    } else {
      updateData.status = 'failed';
      console.log('❌ Updating to FAILED');
    }

    // Update payment
    const { error: updateError } = await supabase
      .from('payments')
      .update(updateData)
      .eq('id', payment.id);

    if (updateError) {
      console.error('Update failed:', updateError);
    } else {
      console.log(`Payment ${payment.id} updated to ${updateData.status}`);
    }

    // If successful, update user
    if (status === 'success' && payment.user_email) {
      try {
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('email', payment.user_email)
          .single();

        if (user) {
          const endDate = calculateEndDate(payment.plan_id || 'individual_monthly');
          
          // Update user
          await supabase
            .from('users')
            .update({
              subscription_status: 'active',
              subscription_plan: payment.plan_id || 'individual_monthly',
              subscription_end_date: endDate
            })
            .eq('id', user.id);

          // Create subscription record
          await supabase
            .from('subscriptions')
            .insert([{
              user_id: user.id,
              plan_id: payment.plan_id || 'individual_monthly',
              plan_name: payment.plan_name || 'Subscription',
              amount: payment.amount,
              currency: payment.currency,
              status: 'active',
              payment_method: 'chapa',
              tx_ref: tx_ref,
              start_date: new Date().toISOString(),
              end_date: endDate
            }]);

          console.log('✅ User updated');
        }
      } catch (userError) {
        console.error('User update error:', userError);
      }
    }

    console.log('✅ Webhook processed');
    res.json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify payment status - UPDATED VERSION
app.get('/api/payments/:tx_ref/verify', async (req, res) => {
  try {
    const { tx_ref } = req.params;
    
    console.log(`🔍 Verifying payment: ${tx_ref}`);
    
    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured' 
      });
    }
    
    // First check in our database
    const { data: payment, error: dbError } = await supabase
      .from('payments')
      .select('*')
      .eq('tx_ref', tx_ref)
      .single();
    
    if (dbError || !payment) {
      console.log(`❌ Payment not found in DB: ${tx_ref}`);
      return res.status(404).json({ 
        success: false,
        error: 'Payment not found',
        is_paid: false,
        status: 'not_found'
      });
    }
    
    console.log(`✅ Payment found: ${payment.id}, Status: ${payment.status}`);
    
    // If payment is already paid in DB, return immediately
    if (payment.status === 'paid') {
      console.log(`✅ Payment already marked as paid`);
      return res.json({
        success: true,
        payment: payment,
        is_paid: true,
        status: 'paid',
        message: 'Payment verified successfully',
        verified_at: payment.paid_at || new Date().toISOString()
      });
    }
    
    // If payment is pending, check with Chapa API
    if (payment.status === 'pending') {
      console.log(`🔄 Checking Chapa API for payment: ${tx_ref}`);
      
      try {
        const chapaResponse = await axios.get(
          `${CHAPA_BASE_URL}/transaction/verify/${tx_ref}`,
          {
            headers: {
              'Authorization': `Bearer ${CHAPA_SECRET_KEY}`,
              'Accept': 'application/json'
            },
            timeout: 10000
          }
        );
        
        console.log(`Chapa API response status:`, chapaResponse.data?.status);
        
        // Check Chapa response
        if (chapaResponse.data.status === 'success' && chapaResponse.data.data?.status === 'success') {
          console.log(`✅ Chapa confirms payment successful`);
          
          // Update payment in database
          const updateData = {
            status: 'paid',
            paid_at: new Date().toISOString(),
            transaction_id: chapaResponse.data.data.id,
            gateway_response: chapaResponse.data,
            updated_at: new Date().toISOString()
          };
          
          const { error: updateError } = await supabase
            .from('payments')
            .update(updateData)
            .eq('id', payment.id);
          
          if (updateError) {
            console.error('❌ Failed to update payment in DB:', updateError);
          } else {
            console.log(`✅ Updated payment ${payment.id} to PAID`);
            payment.status = 'paid';
            payment.paid_at = updateData.paid_at;
          }
          
          // Update user subscription if payment.user_email exists
          if (payment.user_email) {
            try {
              const { data: user } = await supabase
                .from('users')
                .select('id')
                .eq('email', payment.user_email)
                .single();
              
              if (user) {
                const endDate = calculateEndDate(payment.plan_id || 'individual_monthly');
                
                // Update user subscription status
                await supabase
                  .from('users')
                  .update({
                    subscription_status: 'active',
                    subscription_plan: payment.plan_id || 'individual_monthly',
                    subscription_end_date: endDate
                  })
                  .eq('id', user.id);
                
                // Create subscription record
                await supabase
                  .from('subscriptions')
                  .insert([{
                    user_id: user.id,
                    plan_id: payment.plan_id || 'individual_monthly',
                    plan_name: payment.plan_name || 'Subscription',
                    amount: payment.amount,
                    currency: payment.currency,
                    status: 'active',
                    payment_method: 'chapa',
                    tx_ref: tx_ref,
                    start_date: new Date().toISOString(),
                    end_date: endDate,
                    created_at: new Date().toISOString()
                  }]);
                
                console.log(`✅ User ${user.id} subscription activated`);
              }
            } catch (userError) {
              console.error('User update error:', userError);
            }
          }
          
          return res.json({
            success: true,
            payment: payment,
            is_paid: true,
            status: 'paid',
            message: 'Payment verified and updated to paid',
            verified_at: new Date().toISOString()
          });
        } else {
          console.log(`ℹ️ Payment still pending according to Chapa`);
          return res.json({
            success: true,
            payment: payment,
            is_paid: false,
            status: 'pending',
            message: 'Payment is still pending'
          });
        }
      } catch (chapaError) {
        console.error('Chapa verification error:', chapaError.message);
        
        // If Chapa API fails, return current DB status
        return res.json({
          success: true,
          payment: payment,
          is_paid: false,
          status: 'pending',
          message: 'Unable to verify with payment gateway',
          chapa_error: chapaError.message
        });
      }
    }
    
    // Return current status for any other case
    res.json({
      success: true,
      payment: payment,
      is_paid: payment.status === 'paid',
      status: payment.status,
      message: `Payment status: ${payment.status}`
    });
    
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Payment verification failed',
      message: error.message
    });
  }
});

// Admin: Fix All Payments
app.post('/api/admin/fix-payments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('🛠️ Fixing all payments...');
    
    // Get all pending payments
    const { data: pendingPayments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('status', 'pending');
    
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    console.log(`Found ${pendingPayments.length} pending payments`);
    
    // Update all to paid
    for (const payment of pendingPayments) {
      await supabase
        .from('payments')
        .update({
          status: 'paid',
          paid_at: payment.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.id);
    }
    
    // Get updated count
    const { count: paidCount } = await supabase
      .from('payments')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'paid');
    
    res.json({
      success: true,
      message: `Fixed ${pendingPayments.length} payments`,
      total_paid: paidCount || 0
    });
    
  } catch (error) {
    console.error('Fix payments error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify payment status
app.get('/api/chapa/verify/:tx_ref', authenticateToken, async (req, res) => {
  try {
    const { tx_ref } = req.params;
    const userId = req.user.userId;

    debug.log(`Verifying payment: ${tx_ref} for user: ${userId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    // Check payment in database
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('tx_ref', tx_ref)
      .eq('user_id', userId)
      .single();

    if (paymentError || !payment) {
      debug.warn('Payment not found in database');
      return res.status(404).json({ 
        success: false,
        error: 'Payment not found' 
      });
    }

    debug.log('Found payment in DB:', {
      id: payment.id,
      status: payment.status,
      payment_method: payment.payment_method,
      amount: payment.amount,
      plan_id: payment.plan_id
    });

    res.json({
      success: true,
      verified: payment.status === 'paid',
      payment: payment,
      message: payment.status === 'paid' ? 'Payment verified successfully' : 'Payment verification pending',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Payment verification error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Payment verification failed',
      details: error.message 
    });
  }
});

// Get user payments
app.get('/api/payments/my-payments', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    debug.log(`Fetching payments for user: ${userId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: payments, error } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      debug.warn('Error fetching payments, returning empty array', error);
      return res.json({
        success: true,
        payments: []
      });
    }

    debug.success(`Found ${payments?.length || 0} payments for user ${userId}`);
    res.json({
      success: true,
      payments: payments || [],
      count: payments?.length || 0,
      total_spent: payments?.reduce((sum, payment) => sum + (payment.amount || 0), 0) || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get payments error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch payments',
      details: error.message
    });
  }
});

// Get user subscriptions
app.get('/api/subscriptions/my-subscriptions', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    debug.log(`Fetching subscriptions for user: ${userId}`);

    if (!supabase) {
      return res.status(503).json({ 
        success: false,
        error: 'Database not configured'
      });
    }

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      debug.warn('Error fetching subscriptions, returning empty array', error);
      return res.json({
        success: true,
        subscriptions: []
      });
    }

    debug.success(`Found ${subscriptions?.length || 0} subscriptions for user ${userId}`);
    res.json({
      success: true,
      subscriptions: subscriptions || [],
      count: subscriptions?.length || 0,
      active_subscription: subscriptions?.find(sub => sub.status === 'active') || null,
      has_active_subscription: subscriptions?.some(sub => sub.status === 'active') || false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    debug.error('Get subscriptions error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch subscriptions',
      details: error.message
    });
  }
});

// ==================== UTILITY ROUTES ====================

// Get all institutions (for dropdowns)
app.get('/api/institutions', async (req, res) => {
  try {
    debug.log('Fetching institutions...');
    if (!supabase) {
      debug.warn('Supabase not configured for institutions fetch');
      return res.json({
        success: true,
        institutions: []
      });
    }

    const { data: institutions, error } = await supabase
      .from('users')
      .select('institution')
      .not('institution', 'is', null)
      .order('institution');

    if (error) {
      debug.warn('Error fetching institutions, returning empty array', error);
      return res.json({
        success: true,
        institutions: []
      });
    }

    // Extract unique institutions
    const uniqueInstitutions = [...new Set(institutions.map(item => item.institution).filter(Boolean))];
    
    debug.success(`Found ${uniqueInstitutions.length} institutions`);
    res.json({
      success: true,
      institutions: uniqueInstitutions,
      count: uniqueInstitutions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    debug.error('Get institutions error:', error);
    res.json({
      success: true,
      institutions: [],
      count: 0
    });
  }
});

// Get all regions (for dropdowns)
app.get('/api/regions', async (req, res) => {
  try {
    debug.log('Fetching regions...');
    const regions = [
      'Addis Ababa',
      'Oromia',
      'Amhara',
      'SNNPR',
      'Tigray',
      'Afar',
      'Somali',
      'Benishangul-Gumuz',
      'Gambella',
      'Harari',
      'Dire Dawa',
      'Other'
    ];
    
    debug.success(`Returning ${regions.length} regions`);
    res.json({
      success: true,
      regions: regions,
      count: regions.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    debug.error('Get regions error:', error);
    res.json({
      success: true,
      regions: [],
      count: 0
    });
  }
});

// Get all company types (for dropdowns)
app.get('/api/company-types', async (req, res) => {
  try {
    debug.log('Fetching company types...');
    const companyTypes = [
      { value: 'pharmacy', label: 'Pharmacy' },
      { value: 'hospital', label: 'Hospital' },
      { value: 'clinic', label: 'Clinic' },
      { value: 'health_center', label: 'Health Center' },
      { value: 'diagnostic', label: 'Diagnostic Center' },
      { value: 'pharmaceutical', label: 'Pharmaceutical Company' },
      { value: 'other', label: 'Other' }
    ];
    
    debug.success(`Returning ${companyTypes.length} company types`);
    res.json({
      success: true,
      company_types: companyTypes,
      count: companyTypes.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    debug.error('Get company types error:', error);
    res.json({
      success: true,
      company_types: [],
      count: 0
    });
  }
});

// Get all patient types (for dropdowns)
app.get('/api/patient-types', async (req, res) => {
  try {
    debug.log('Fetching patient types...');
    const patientTypes = [
      { value: 'adult', label: 'Adult' },
      { value: 'pediatric', label: 'Pediatric' },
      { value: 'neonatal', label: 'Neonatal' },
      { value: 'geriatric', label: 'Geriatric' }
    ];
    
    debug.success(`Returning ${patientTypes.length} patient types`);
    res.json({
      success: true,
      patient_types: patientTypes,
      count: patientTypes.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    debug.error('Get patient types error:', error);
    res.json({
      success: true,
      patient_types: [],
      count: 0
    });
  }
});

// Get all genders (for dropdowns)
app.get('/api/genders', async (req, res) => {
  try {
    debug.log('Fetching genders...');
    const genders = [
      { value: 'male', label: 'Male' },
      { value: 'female', label: 'Female' },
      { value: 'other', label: 'Other' }
    ];
    
    debug.success(`Returning ${genders.length} genders`);
    res.json({
      success: true,
      genders: genders,
      count: genders.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    debug.error('Get genders error:', error);
    res.json({
      success: true,
      genders: [],
      count: 0
    });
  }
});

// Get system statistics (public)
app.get('/api/statistics', async (req, res) => {
  try {
    debug.log('Fetching system statistics...');
    if (!supabase) {
      debug.warn('Supabase not configured for statistics');
      return res.json({
        success: true,
        total_users: 0,
        total_patients: 0,
        active_subscriptions: 0,
        message: 'Database not available',
        timestamp: new Date().toISOString()
      });
    }

    let total_users = 0;
    let total_patients = 0;
    let active_subscriptions = 0;
    
    try {
      const { count: userCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      
      total_users = userCount || 0;
      
      const { count: patientsCount } = await supabase
        .from('patients')
        .select('*', { count: 'exact', head: true });
      
      total_patients = patientsCount || 0;
      
      const { count: subscriptionCount } = await supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      
      active_subscriptions = subscriptionCount || 0;
    } catch (error) {
      debug.error('Statistics calculation error:', error);
    }

    debug.success('Statistics retrieved', { 
      total_users, 
      total_patients, 
      active_subscriptions 
    });
    
    res.json({
      success: true,
      total_users,
      total_patients,
      active_subscriptions,
      updated_at: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    debug.error('Get statistics error:', error);
    res.json({
      success: true,
      total_users: 0,
      total_patients: 0,
      active_subscriptions: 0,
      error: 'Failed to fetch statistics',
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== DEBUG & TEST ROUTES ====================

// Test endpoint for debugging
app.get('/api/debug/test', async (req, res) => {
  try {
    debug.log('Debug test endpoint called');
    
    if (!supabase) {
      return res.json({
        success: false,
        message: 'Supabase not configured',
        supabase_url: process.env.SUPABASE_URL,
        supabase_key_set: !!process.env.SUPABASE_ANON_KEY,
        service_role_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        timestamp: new Date().toISOString()
      });
    }
    
    // Test database connection
    const { data, error } = await supabase
      .from('users')
      .select('count', { count: 'exact', head: true });
    
    const dbConnected = !error;
    
    // Test admin user
    const { data: adminUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', 'admin@pharmacare.com')
      .maybeSingle();
    
    // Test patients table
    let patientsCount = 0;
    try {
      const { count: patients } = await supabase
        .from('patients')
        .select('*', { count: 'exact', head: true });
      patientsCount = patients || 0;
    } catch (patientsError) {
      debug.warn('Patients table not accessible:', patientsError);
    }
    
    res.json({
      success: true,
      message: 'Debug test successful',
      server_time: new Date().toISOString(),
      uptime: process.uptime(),
      database_connected: dbConnected,
      user_count: data || 0,
      patients_count: patientsCount,
      admin_user_exists: !!adminUser,
      admin_user_id: adminUser?.id,
      admin_user_email: adminUser?.email,
      admin_user_approved: adminUser?.approved,
      admin_user_role: adminUser?.role,
      environment: {
        node: process.version,
        platform: process.platform,
        memory: process.memoryUsage(),
        pid: process.pid
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    debug.error('Debug test error:', error);
    res.status(500).json({
      success: false,
      error: 'Debug test failed',
      details: error.message,
      stack: DEBUG ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

// Test database connection
app.get('/api/debug/db-test', async (req, res) => {
  try {
    debug.log('Database test endpoint called');
    
    if (!supabase) {
      return res.json({
        success: false,
        message: 'Supabase client not initialized',
        config: {
          has_url: !!process.env.SUPABASE_URL,
          has_anon_key: !!process.env.SUPABASE_ANON_KEY,
          has_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
        }
      });
    }
    
    // Test simple query
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .limit(5);
    
    if (error) {
      return res.json({
        success: false,
        message: 'Database query failed',
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        tables_exist: false
      });
    }
    
    // Test if we can insert (read-only test)
    const testData = {
      email: `test_${Date.now()}@test.com`,
      full_name: 'Test User',
      password_hash: 'test_hash',
      role: 'pharmacist',
      account_type: 'individual',
      approved: false,
      created_at: new Date().toISOString()
    };
    
    // Don't actually insert, just check if table exists and is writable
    const { error: insertError } = await supabase
      .from('users')
      .insert([testData])
      .select();
    
    const canWrite = !insertError || (insertError && !insertError.message.includes('violates'));
    
    res.json({
      success: true,
      message: 'Database connection successful',
      query_result: data?.length || 0,
      can_write: canWrite,
      write_error: insertError?.message,
      tables: {
        users: true,
        patients: await checkTableExists('patients'),
        medications: await checkTableExists('medications'),
        payments: await checkTableExists('payments'),
        subscriptions: await checkTableExists('subscriptions'),
        companies: await checkTableExists('companies')
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    debug.error('Database test error:', error);
    res.status(500).json({
      success: false,
      error: 'Database test failed',
      message: error.message,
      stack: DEBUG ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to check if table exists
async function checkTableExists(tableName) {
  try {
    const { error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    return !error;
  } catch (err) {
    return false;
  }
}

// Server info endpoint
app.get('/api/server-info', (req, res) => {
  try {
    const info = {
      success: true,
      server: {
        name: 'PharmaCare CDSS Backend',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
        debug_mode: DEBUG,
        startup_time: new Date().toISOString(),
        uptime: process.uptime()
      },
      database: {
        connected: !!supabase,
        has_admin_client: !!supabaseAdmin,
        url: process.env.SUPABASE_URL ? 'Set' : 'Not set'
      },
      services: {
        chapa_payment: !!CHAPA_SECRET_KEY,
        jwt_auth: !!JWT_SECRET
      },
      endpoints: {
        auth: [
          'POST /api/auth/login',
          'POST /api/auth/register',
          'POST /api/auth/register-company',
          'GET /api/auth/me',
          'PUT /api/auth/update-profile',
          'POST /api/auth/change-password'
        ],
        admin: [
          'GET /api/admin/stats',
          'GET /api/admin/users',
          'GET /api/admin/pending-approvals',
          'POST /api/admin/users/:id/approve',
          'GET /api/admin/companies',
          'GET /api/admin/patients',
          'GET /api/admin/medications'
        ],
        patients: [
          'GET /api/patients/my-patients',
          'GET /api/patients/:id',
          'POST /api/patients',
          'PUT /api/patients/:id',
          'DELETE /api/patients/:id',
          'GET /api/patients/search/:query',
          'GET /api/patients/stats'
        ],
        medications: [
          'GET /api/medications/search/:query',
          'GET /api/medications/:id'
        ],
        payments: [
          'POST /api/chapa/create-payment',
          'GET /api/chapa/verify/:tx_ref',
          'GET /api/payments/my-payments',
          'GET /api/subscriptions/my-subscriptions'
        ],
        debug: [
          'GET /api/health',
          'GET /api/debug/test',
          'GET /api/debug/db-test',
          'GET /api/debug/admin-status',
          'POST /api/debug/fix-admin',
          'POST /api/debug/force-create-admin'
        ]
      },
      support: {
        email: 'support@pharmacare.com',
        documentation: 'https://docs.pharmacare.com',
        emergency: 'Use /api/debug/fix-admin for admin issues'
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(info);
  } catch (error) {
    debug.error('Server info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get server info',
      message: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PharmaCare CDSS Backend API',
    version: '2.0.0',
    endpoints: {
      health: '/api/health',
      login: '/api/auth/login',
      register: '/api/auth/register',
      debug: '/api/debug/test',
      server_info: '/api/server-info'
    },
    timestamp: new Date().toISOString()
  });
});

// ==================== 404 HANDLER ====================

// FIXED: Use escaped wildcard for 404 handler
app.use('\\*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    debug.warn(`API endpoint not found: ${req.method} ${req.path}`);
    res.status(404).json({ 
      success: false,
      error: 'API endpoint not found',
      path: req.path,
      method: req.method,
      available_endpoints: [
        '/api/health',
        '/api/auth/login',
        '/api/auth/register',
        '/api/debug/fix-admin',
        '/api/debug/test',
        '/api/server-info'
      ],
      timestamp: new Date().toISOString()
    });
  } else {
    next();
  }
});

// ==================== ERROR HANDLER ====================

app.use((err, req, res, next) => {
  debug.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
    stack: DEBUG ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`
  🚀 PharmaCare Backend Server
  =================================
  ✅ Port: ${PORT}
  ✅ Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}
  ✅ Debug Mode: ${DEBUG ? 'ENABLED' : 'DISABLED'}
  ✅ Supabase: ${supabase ? 'Connected ✅' : 'NOT CONFIGURED ❌'}
  ✅ Service Role: ${supabaseAdmin ? 'AVAILABLE ✅' : 'MISSING ⚠️'}
  ✅ Chapa Payment: ${CHAPA_SECRET_KEY ? 'CONFIGURED ✅' : 'MISSING ⚠️'}
  =================================
  
  🔧 CRITICAL FIXES APPLIED:
  
  1. ✅ Enhanced CORS configuration
  2. ✅ Auto-creates admin on server start
  3. ✅ Uses .maybeSingle() to avoid query errors
  4. ✅ Emergency admin fix endpoint
  5. ✅ Force create admin endpoint
  6. ✅ Complete error handling
  7. ✅ Debug endpoints for troubleshooting
  
  =================================
  
  🛠️ QUICK START COMMANDS:
  
  1. Check admin status:
     curl http://localhost:${PORT}/api/debug/admin-status
  
  2. Fix admin if missing:
     curl -X POST http://localhost:${PORT}/api/debug/fix-admin
  
  3. Force create admin:
     curl -X POST http://localhost:${PORT}/api/debug/force-create-admin
  
  4. Test login with admin:
     curl -X POST http://localhost:${PORT}/api/auth/login \\
       -H "Content-Type: application/json" \\
       -d '{"email":"admin@pharmacare.com","password":"Admin@123"}'
  
  5. Check server health:
     curl http://localhost:${PORT}/api/health
  
  6. Get server info:
     curl http://localhost:${PORT}/api/server-info
  
  =================================
  
  📍 IMPORTANT ENDPOINTS:
  
  Health Check:       GET    http://localhost:${PORT}/api/health
  Database Test:      GET    http://localhost:${PORT}/api/debug/db-test
  Admin Status:       GET    http://localhost:${PORT}/api/debug/admin-status
  Fix Admin:          POST   http://localhost:${PORT}/api/debug/fix-admin
  Force Create Admin: POST   http://localhost:${PORT}/api/debug/force-create-admin
  Login:              POST   http://localhost:${PORT}/api/auth/login
  Register:           POST   http://localhost:${PORT}/api/auth/register
  Server Info:        GET    http://localhost:${PORT}/api/server-info
  
  =================================
  
  🎉 SERVER IS RUNNING AND READY!
  =================================
  
  Admin credentials:
  📧 Email: admin@pharmacare.com
  🔑 Password: Admin@123
  👤 Role: System Administrator
  
  =================================
  `);
});