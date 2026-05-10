const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const admin = require('firebase-admin');
const appleSignin = require('apple-signin-auth');

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


const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

/**
 * Verify Google ID Token (Directly from Google Sign-In)
 * @param {String} idToken 
 */
const verifyGoogleToken = async (idToken) => {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_WEB_CLIENT_ID,
    });
    const decoded = ticket.getPayload();

    return {
      uid: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
      sub: decoded.sub,
    };
  } catch (error) {
    console.error('Error verifying Google token:', error);
    return null;
  }
};

/**
 * Verify Apple ID Token
 * @param {String} idToken 
 */
const verifyAppleToken = async (idToken) => {
  try {
    // Support multiple Client IDs (iOS Bundle ID and Android Service ID)
    const clientIds = process.env.APPLE_CLIENT_ID ? process.env.APPLE_CLIENT_ID.split(',') : [];

    const { sub, email } = await appleSignin.verifyIdToken(idToken, {
      audience: clientIds,
      ignoreExpiration: false,
    });

    return {
      uid: sub,
      email: email,
      name: null,
      sub: sub,
    };
  } catch (error) {
    console.error('Error verifying Apple token:', error);
    return null;
  }
};

module.exports = {
  generateUserTokens,
  verifyUserToken,
  verifyUserRefreshToken,
  verifyFirebaseToken,
  verifyAppleToken,
  verifyGoogleToken
};
