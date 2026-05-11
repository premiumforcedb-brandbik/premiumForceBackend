const User = require('../models/users_model');
const jwt = require('jsonwebtoken');
const twilioVerifyService = require('../services/twilioVerifyService');


// Generate tokens
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    {
      userId: user._id,
      phoneNumber: user.phoneNumber,
      role: user.role
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '1d' }
  );


  const refreshToken = jwt.sign(
    { userId: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};



// Send OTP
const sendOTP = async (req, res) => {
  try {
    const { phoneNumber, countryCode, channel = 'sms' } = req.body;

    if (!phoneNumber || !countryCode) {
      return res.status(400).json({ success: false, message: 'Phone number and country code are required' });
    }

    if (!['sms', 'whatsapp'].includes(channel)) {
      return res.status(400).json({ success: false, message: 'Invalid channel' });
    }

    // Use Twilio Verify instead of manual generation and DB storage
    const result = await twilioVerifyService.sendVerification(phoneNumber, countryCode, channel);

    if (result.success) {
      res.json({ success: true, message: `OTP sent via ${channel}` });
    } else {
      res.status(400).json({ success: false, message: 'Failed to send OTP' });
    }
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({ success: false, error: error.message, message: "Failed to send OTP" });
  }
};




// Resend OTP
const resendOTP = async (req, res) => {
  return sendOTP(req, res);
};


// Verify OTP and return JWT tokens

const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, countryCode, otp } = req.body;

    if (!phoneNumber || !countryCode || !otp) {
      return res.status(400).json({ success: false, message: 'Phone number, country code, OTP and purpose are required' });
    }

    // Use Twilio Verify to check the code
    const verifyResult = await twilioVerifyService.checkVerification(phoneNumber, countryCode, otp);

    if (!verifyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP',
        details: verifyResult.error
      });
    }

    let user = await User.findOne({ phoneNumber, countryCode });


    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please register first.'
      });
    }

    user.lastLogin = new Date();
    await user.save();

    // Generate JWT tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Save refresh token to user
    user.refreshToken = refreshToken;
    await user.save();

    // Return user data
    const userData = {
      _id: user._id,
      username: user.username,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLogin: user.lastLogin
    };

    res.json({
      success: true,
      message: 'OTP verified successfully',
      accessToken,
      refreshToken,
      user: userData
    });

  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};



// Refresh token endpoint
// Refresh token endpoint
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return res.status(401).json({ success: false, message: 'Refresh token required' });
    }

    console.log('=== REFRESH TOKEN DEBUG ===');
    console.log('Token received (first 20 chars):', token.substring(0, 20) + '...');
    console.log('JWT_REFRESH_SECRET exists:', !!process.env.JWT_REFRESH_SECRET);

    // Verify refresh token
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    console.log('Token verified. User ID:', decoded.userId);

    // Find user with this refresh token
    const user = await User.findOne({
      _id: decoded.userId,
      refreshToken: token
    });

    if (!user) {
      console.log('User not found or token mismatch');
      console.log('Searched for userId:', decoded.userId);

      // Check if user exists at all
      const userExists = await User.findById(decoded.userId);
      console.log('User exists in DB:', !!userExists);

      if (userExists) {
        console.log('User found but refresh token mismatch');
        console.log('DB refresh token:', userExists.refreshToken ? userExists.refreshToken.substring(0, 20) + '...' : 'null');
      }

      return res.status(403).json({ success: false, message: 'Invalid refresh token' });
    }

    console.log('User found, generating new tokens');

    // Generate new tokens
    const newAccessToken = jwt.sign(
      {
        userId: user._id,
        phoneNumber: user.phoneNumber,
        role: user.role
      },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '1d' }
    );

    const newRefreshToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Update refresh token in database
    user.refreshToken = newRefreshToken;
    await user.save();

    console.log('Tokens refreshed successfully');

    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });

  } catch (error) {
    console.error('Refresh Token Error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);

    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ success: false, message: 'Invalid refresh token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ success: false, message: 'Refresh token expired' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
};

// Logout
const logout = async (req, res) => {
  try {
    const { userId } = req.user;

    await User.findByIdAndUpdate(userId, {
      $unset: { refreshToken: 1 }
    });

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  sendOTP,
  resendOTP,
  verifyOTP,
  refreshToken,
  logout
};