const jwt = require('jsonwebtoken');

/**
 * Generate Access and Refresh tokens specifically for Admin users
 * @param {Object} admin - The admin object from database
 */
const generateAdminTokens = (admin) => {
  const payload = {
    id: admin._id,
    adminId: admin._id, // Backward compatibility
    email: admin.email,
    role: admin.role,
    accessLevel: admin.accessLevel,
    type: 'admin'
  };

  const accessToken = jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d' }
  );

  const refreshToken = jwt.sign(
    { id: admin._id, type: 'admin' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );

  return { accessToken, refreshToken };
};

/**
 * Verify admin access token
 * @param {String} token 
 */
const verifyAdminToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateAdminTokens,
  verifyAdminToken
};
