const express = require('express');
const router = express.Router();
const User = require('../models/users_model');
const {
  generateUserTokens,
  verifyFirebaseToken,
  verifyAppleToken,
  verifyGoogleToken,
  verifyUserRefreshToken
} = require('../utils/userAuthUtils');

/**
 * @route   POST /api/auth/google
 * @desc    Authenticate user with Google via Firebase ID token
 * @access  Public
 */
router.post('/google', async (req, res) => {
  const { idToken } = req.body;

  try {
    const userData = await verifyGoogleToken(idToken);

    if (!userData) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired ID token'
      });
    }

    const { uid, email, name, sub } = userData;

    let user = await User.findOne({
      $or: [
        { email: email },
        { googleId: uid },
        { googleId: sub }
      ]
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'User not found',
        data: {
          userExists: false,
          email: email,
          name: name,
        }
      })
    }


    user.lastLogin = new Date();
    user.provider = 'google';
    user.googleId = uid || sub;
    await user.save();

    // Generate JWT tokens for our backend
    const { accessToken, refreshToken } = generateUserTokens(user);

    // Return response
    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      data: {
        userExists: true,
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          role: user.role,
        },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer'
        }
      }
    });

  } catch (error) {
    console.error('❌ Google Auth Error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/auth/apple
 * @desc    Authenticate user with Apple via direct verification
 * @access  Public
 */
router.post('/apple', async (req, res) => {
  const { idToken, name: appleName } = req.body;

  if (!idToken) {
    return res.status(400).json({
      success: false,
      error: 'ID Token is required'
    });
  }

  try {
    const appleUser = await verifyAppleToken(idToken);

    if (!appleUser) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired ID token'
      });
    }

    const { uid, email, name, sub } = appleUser;

    let user = await User.findOne({
      $or: [
        { email: email },
        { appleId: uid },
        { appleId: sub }
      ]
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'User not found',
        data: {
          userExists: false,
          email: email,
          name: appleName || name,
        }
      });
    }

    if (user) {
      user.lastLogin = new Date();
      user.provider = 'apple';
      user.appleId = uid || sub;
      await user.save();
      console.log(`✅ Existing user logged in via Apple: ${email}`);
    }

    const { accessToken, refreshToken } = generateUserTokens(user);

    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      data: {
        userExists: true,
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          role: user.role,
        },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer'
        }
      }
    });

  } catch (error) {
    console.error('❌ Apple Auth Error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Get new access token using refresh token
 * @access  Public
 */
router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: 'Refresh token is required'
    });
  }

  try {
    // Verify refresh token using utility
    const decoded = verifyUserRefreshToken(refreshToken);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired refresh token'
      });
    }

    // Find user by ID
    const user = await User.findById(decoded.userId || decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    // Check token version to invalidate old refresh tokens (if implemented)
    if (user.tokenVersion !== undefined && decoded.tokenVersion !== undefined) {
      if (user.tokenVersion !== decoded.tokenVersion) {
        return res.status(401).json({
          success: false,
          error: 'Refresh token has been revoked'
        });
      }
    }

    // Generate new tokens
    const tokens = generateUserTokens(user);

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      tokens: {
        ...tokens,
        tokenType: 'Bearer'
      }
    });

  } catch (error) {
    console.error('❌ Refresh Token Error:', error);
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token'
    });
  }
});

module.exports = router;
