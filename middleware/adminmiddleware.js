const jwt = require('jsonwebtoken');
const Admin = require('../models/adminModel');
const { verifyAdminToken } = require('../utils/adminAuthUtils');

// Store refresh tokens (in production, use Redis or database)
// Note: This is a fallback, ideally tokens are managed in DB via Admin model
let refreshTokens = new Set();

/**
 * Middleware to verify JWT access token for admins
 */
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required' 
    });
  }

  const decoded = verifyAdminToken(token);
  if (!decoded) {
    return res.status(403).json({ 
      success: false, 
      message: 'Invalid or expired token' 
    });
  }

  try {
    // Basic verification of user from token
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication error' 
    });
  }
};

/**
 * Middleware to check if user has admin role and is active
 */
const authorizeAdmin = async (req, res, next) => {
  // Ensure we have a user from authenticateToken
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ 
      success: false, 
      message: 'Admin access required' 
    });
  }

  try {
    const admin = await Admin.findById(req.user.id || req.user.adminId).populate('cityID');

    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }

    if (!admin.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: 'Admin account is deactivated' 
      });
    }

    // Attach full admin object to request
    req.admin = admin;
    next();
  } catch (error) {
    console.error('Authorize admin error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Authorization error' 
    });
  }
};

/**
 * Middleware to check specific roles
 */
const authorizeRoles = (...roles) => {
  return async (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}`
      });
    }

    // Always verify active status for admin roles
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      try {
        const admin = await Admin.findById(req.user.id || req.user.adminId).populate('cityID');
        if (!admin || !admin.isActive) {
          return res.status(403).json({ 
            success: false, 
            message: 'Admin account is deactivated or not found' 
          });
        }
        req.admin = admin;
      } catch (error) {
        return res.status(500).json({ 
          success: false, 
          message: 'Authorization error' 
        });
      }
    }

    next();
  };
};

/**
 * Middleware to check accessLevel
 * accessLevel 0: Full Control (SuperAdmin)
 * accessLevel 1: Restricted Control (Dispatcher/Admin)
 */
const authorizeAccessLevel = (requiredLevel) => {
  return async (req, res, next) => {
    // If req.admin is not already attached, fetch it
    if (!req.admin) {
      try {
        const adminId = req.user?.id || req.user?.adminId;
        if (!adminId) {
          return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const admin = await Admin.findById(adminId);
        if (!admin) {
          return res.status(401).json({ success: false, message: 'Admin not found' });
        }
        req.admin = admin;
      } catch (error) {
        return res.status(500).json({ success: false, message: 'Authorization error' });
      }
    }

    // accessLevel 0 always has access
    if (req.admin.accessLevel === 0) {
      return next();
    }

    // Check if admin has the required level or higher (lower number = higher level)
    if (req.admin.accessLevel > requiredLevel) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Higher access level required (Current: ${req.admin.accessLevel}, Required: ${requiredLevel})`
      });
    }

    next();
  };
};

/**
 * Helper to allow all authenticated users (any role)
 */
const authorizeAny = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  next();
};

/**
 * Refresh token logic moved to middleware for reuse
 */
const authenticateRefreshToken = async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Check if admin exists and is active
    const admin = await Admin.findOne({ _id: decoded.id, refreshToken: refreshToken });
    
    if (!admin || !admin.isActive) {
      return res.status(403).json({ success: false, message: 'Invalid refresh token or account deactivated' });
    }

    req.admin = admin;
    req.refreshToken = refreshToken;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};

module.exports = {
  authenticateToken,
  authorizeAdmin,
  authorizeRoles,
  authorizeAccessLevel,
  authorizeAny,
  authenticateRefreshToken
};