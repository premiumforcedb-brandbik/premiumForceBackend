const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const admin = require('firebase-admin');

/**
 * Generate Access and Refresh tokens specifically for Users/Customers
 * @param {Object} user - The user object from database
 */
const generateUserTokens = (user) => {
  // Consolidating fields from server.js and userRoutes.js for maximum compatibility
  const payload = {
    id: user._id || user.id,
    userId: user._id || user.id,
    email: user.email,
    username: user.username,
    name: user.name || user.username,
    role: user.role || 'customer',
    provider: user.provider || 'local'
  };

  const accessToken = jwt.sign(
    payload,
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_ACCESS_EXPIRY || process.env.JWT_EXPIRY || '1d',
      issuer: 'Premiumforce',
      audience: 'Premiumforce-client'
    }
  );

  const refreshToken = jwt.sign(
    {
      id: user._id || user.id,
      userId: user._id || user.id,
      type: 'user',
      tokenVersion: user.tokenVersion || 0
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );

  return { accessToken, refreshToken };
};

/**
 * Verify user access token
 * @param {String} token 
 */
const verifyUserToken = (token) => {
  try {
    return jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
      {
        issuer: 'Premiumforce',
        audience: 'Premiumforce-client'
      }
    );
  } catch (error) {
    return null;
  }
};

/**
 * Verify user refresh token
 * @param {String} token 
 */
const verifyUserRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};

/**
 * Verify Firebase ID Token
 * @param {String} idToken 
 */
const verifyFirebaseToken = async (idToken) => {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);

    return {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      sub: decoded.sub,
    };
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    return null;
  }
};


module.exports = {
  generateUserTokens,
  verifyUserToken,
  verifyUserRefreshToken,
  verifyFirebaseToken
};
