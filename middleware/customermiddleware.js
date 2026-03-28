const jwt = require('jsonwebtoken');
const Customer = require('../models/users_model');

// ============= CUSTOMER AUTHENTICATION =============
const authenticateCustomer = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // FIXED: Try different possible field names from JWT token
    let customerId = decoded.customerId || decoded.userId || decoded.id || decoded._id;
    
    if (!customerId) {
      console.error('No customer ID found in token. Decoded payload:', decoded);
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
    }
    
    const customer = await Customer.findById(customerId).select('-refreshToken');
    
    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (!customer.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Customer account is inactive'
      });
    }

    req.customer = {
      customerId: customer._id,
      phoneNumber: customer.phoneNumber,
      name: customer.name,
      email: customer.email
    };
    
    req.token = token;
    next();
    
  } catch (error) {
    console.error('Customer authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Authentication error',
      error: error.message
    });
  }
};

module.exports = {
  authenticateCustomer
};