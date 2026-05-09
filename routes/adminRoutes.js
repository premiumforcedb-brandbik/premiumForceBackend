// routes/adminRoutes.js
const express = require('express');
const Admin = require('../models/adminModel');
const User = require('../models/users_model');
const Driver = require('../models/driver_model');
const Booking = require('../models/booking_model');
const HourlyBooking = require('../models/hourlyBookingModel');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const {
  authenticateToken,
  authorizeAdmin,
  authorizeAccessLevel,
  authenticateRefreshToken
} = require('../middleware/adminmiddleware');
const { generateAdminTokens } = require('../utils/adminAuthUtils');

const router = express.Router();


/**
 * @route   POST /api/admin/fcm-token
 * @desc    Save FCM token for admin
 * @access  Private
 */
router.post('/fcm-token', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { fcmToken } = req.body;


    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'fcmToken is required and must be a string.',
      });
    }

    const admin = await Admin.findByIdAndUpdate(
      req.admin._id,
      { fcmToken },
      { new: true, select: '_id email role' }
    );

    console.log(`🔔 FCM token saved for admin ${admin.email} (${admin._id})`);
    res.json({
      success: true,
      fcmToken: fcmToken,
      message: 'FCM token registered.'
    });
  } catch (err) {
    console.error('FCM token route error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});


/**
 * @route   DELETE /api/admin/fcm-token
 * @desc    Clear FCM token on logout
 * @access  Private
 */
router.delete('/fcm-token', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    await Admin.findByIdAndUpdate(req.admin._id, { fcmToken: null });
    res.json({ success: true, message: 'FCM token cleared.' });
  } catch (err) {
    console.error('FCM token delete error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * @route   POST /api/admin/register
 * @desc    Register a new admin
 * @access  Public (or maybe Private with superadmin role)
 */
router.post('/register',
  authenticateToken, authorizeAdmin, authorizeAccessLevel(0),
  async (req, res) => {
    try {
      const { email, name, password,
        accessLevel = 0, phoneNumber, countryCode, cityID } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Please provide email and password'
        });
      }
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Please provide name'
        });
      }

      if (accessLevel == 1 && !cityID) {
        return res.status(400).json({
          success: false,
          message: 'Please provide cityID'
        });
      }

      const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: 'Admin with this email already exists'
        });
      }

      // Create with plain password - middleware will hash it
      const newAdmin = new Admin({
        email: email.toLowerCase(),
        password,
        role: 'admin',
        name,
        accessLevel,
        phoneNumber,
        countryCode,
        cityID
      });

      const savedAdmin = await newAdmin.save();

      // Generate tokens using utility
      const { accessToken, refreshToken } = generateAdminTokens(savedAdmin);

      savedAdmin.refreshToken = refreshToken;
      await savedAdmin.save();

      const adminResponse = savedAdmin.toObject();
      delete adminResponse.refreshToken;
      delete adminResponse.password;

      res.status(201).json({
        success: true,
        message: 'Admin registered successfully',
        data: {
          admin: adminResponse,
          tokens: {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d'
          }
        }
      });
    } catch (error) {
      console.error('Register admin error:', error);
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Admin with this email already exists'
        });
      }
      res.status(500).json({
        success: false,
        message: 'Error registering admin',
        error: error.message
      });
    }
  });


/**
 * @route   POST /api/admin/login
 * @desc    Login admin
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find admin by email
    const admin = await Admin.findOne({ email: email.toLowerCase() });

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact super admin.'
      });
    }

    // Check password
    const isPasswordMatch = await admin.comparePassword(password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate tokens using utility
    const { accessToken, refreshToken } = generateAdminTokens(admin);

    // Save refresh token
    admin.refreshToken = refreshToken;
    await admin.save();

    // Prepare response
    const adminResponse = admin.toObject();
    delete adminResponse.refreshToken;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        admin: adminResponse,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d'
        }
      }
    });
  } catch (error) {
    console.error('Login admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message
    });
  }
});







// GET /api/analytics/dashboard-summary
router.get('/dashboard-summary',
  authenticateToken, authorizeAdmin, authorizeAccessLevel(0),
  async (req, res) => {
    try {

      const { startDate, endDate } = req.query;

      // Date filter
      const dateFilter = {};
      if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
        if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
      }

      // Get all counts in parallel
      const [
        totalUsers,
        totalDrivers,
        activeDrivers,
        totalBookings,
        hourlyBookings,
        completedBookings,
        pendingBookings,
        cancelledBookings,
        hourlyCompletedBookings,
        hourlyPendingBookings,
        hourlyCancelledBookings,
        totalRevenue,
        totalRevenueHourly,
        extraRevenueHourly
      ] = await Promise.all([
        // Total Users
        User.countDocuments({}),

        // Total Drivers (all drivers)
        Driver.countDocuments(dateFilter),

        // Active Drivers (isActive == true)
        Driver.countDocuments({ ...dateFilter, isActive: true }),

        // Total Bookings
        Booking.countDocuments(dateFilter),

        // Hourly Bookings
        HourlyBooking.countDocuments({ ...dateFilter }),

        // Completed Bookings
        Booking.countDocuments({ ...dateFilter, bookingStatus: 'completed' }),

        // Pending Bookings
        Booking.countDocuments({ ...dateFilter, bookingStatus: 'pending' }),

        // Cancelled Bookings
        Booking.countDocuments({ ...dateFilter, bookingStatus: 'cancelled' }),

        // Completed Hourly Bookings
        HourlyBooking.countDocuments({ ...dateFilter, bookingStatus: 'completed' }),

        // Pending Hourly Bookings
        HourlyBooking.countDocuments({ ...dateFilter, bookingStatus: 'pending' }),

        // Cancelled Hourly Bookings
        HourlyBooking.countDocuments({ ...dateFilter, bookingStatus: 'cancelled' }),

        // Total Revenue from Booking (regular bookings)
        Booking.aggregate([
          {
            $match: {
              ...dateFilter
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $toDouble: "$charge" } }
            }
          }
        ]),

        // Total Revenue from HourlyBooking (regular charge)
        HourlyBooking.aggregate([
          {
            $match: {
              ...dateFilter
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $toDouble: "$charge" } }
            }
          }
        ]),

        // Extra Revenue from HourlyBooking (extraPayment)
        HourlyBooking.aggregate([
          {
            $match: {
              ...dateFilter
            }
          },
          {
            $group: {
              _id: null,
              total: { $sum: { $toDouble: "$extraPayment" } }
            }
          }
        ])
      ]);

      // Calculate total revenue correctly
      const regularRevenue = totalRevenue[0]?.total || 0;
      const hourlyChargeRevenue = totalRevenueHourly[0]?.total || 0;
      const hourlyExtraRevenue = extraRevenueHourly[0]?.total || 0;
      const totalRevenueValue = regularRevenue + hourlyChargeRevenue + hourlyExtraRevenue;

      const totalBookingsCount = totalBookings + hourlyBookings;
      const totalCompletedBookings = completedBookings + hourlyCompletedBookings;
      const totalPendingBookings = pendingBookings + hourlyPendingBookings;
      const totalCancelledBookings = cancelledBookings + hourlyCancelledBookings;


      res.json({
        success: true,
        data: {
          users: {
            total: totalUsers
          },
          drivers: {
            total: activeDrivers,
          },

          bookings: {

            total: totalBookingsCount,
            completed: totalCompletedBookings,
            pending: totalPendingBookings,
            cancelled: totalCancelledBookings,
            completionRate: totalBookingsCount > 0
              ? ((totalCompletedBookings / totalBookingsCount) * 100).toFixed(2)
              : 0
          },

          earnings: {
            total: totalRevenueValue
          }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });








/**
 * @route   POST /api/admin/refresh-token
 * @desc    Get new access token using refresh token
 * @access  Public
 */
router.post('/refresh-token', authenticateRefreshToken, async (req, res) => {
  try {
    const admin = req.admin;

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateAdminTokens(admin);

    // Update refresh token in DB
    admin.refreshToken = newRefreshToken;
    await admin.save();

    res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken: newRefreshToken,
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '1d'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/admin/logout
 * @desc    Logout admin (clear refresh token)
 * @access  Private
 */
router.post('/logout', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    // Clear refresh token
    req.admin.refreshToken = null;
    await req.admin.save();

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging out',
      error: error.message
    });
  }
});



/**
 * @route   GET /api/admin/profile
 * @desc    Get admin profile
 * @access  Private
 */
router.get('/profile', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: req.admin
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin
 * @desc    Get all admins with filtering
 * @access  Private (superadmin only ideally)
 */
router.get('/', authenticateToken, authorizeAdmin, authorizeAccessLevel(0), async (req, res) => {
  try {
    const { role, isActive, search, sort, page = 1, limit = 10 } = req.query;
    let query = {};

    // Filtering
    if (role) query.role = role;
    if (isActive !== undefined && isActive !== '') {
      query.isActive = isActive === 'true';
    }

    // Search functionality (name or email)
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Sorting
    let sortOption = {};
    if (sort === 'newest') sortOption.createdAt = -1;
    else if (sort === 'oldest') sortOption.createdAt = 1;
    else if (sort === 'name') sortOption.name = 1;
    else if (sort === 'email') sortOption.email = 1;
    else sortOption.createdAt = -1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const admins = await Admin.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(parseInt(limit))
      .select('-refreshToken -__v -password')
      .populate('cityID', 'cityName');

    const total = await Admin.countDocuments(query);


    const adminsWithExtraData = admins.map(admin => {
      const adminObj = admin.toObject();

      return {
        ...adminObj,
        city: admin.cityID ? admin.cityID.cityName : null,
        isMe: admin._id.toString() === req.admin._id.toString()
      };
    });

    res.status(200).json({
      success: true,
      count: admins.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: adminsWithExtraData
    });
  } catch (error) {
    console.error('Fetch all admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching admins',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/admin/:id
 * @desc    Get admin by ID
 * @access  Private
 */
router.get('/:id', authenticateToken, authorizeAdmin, authorizeAccessLevel(0), async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id)
      .select('-refreshToken -__v -password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.status(200).json({
      success: true,
      data: admin
    });
  } catch (error) {
    console.error('Fetch admin error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching admin',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/admin/:id
 * @desc    Update admin
 * @access  Private
 */
router.put('/:id', authenticateToken, authorizeAdmin, authorizeAccessLevel(0), async (req, res) => {
  try {
    const { email, name, password, role, isActive, accessLevel,
      phoneNumber, countryCode, cityID } = req.body;

    // Find the admin we want to update
    const adminToUpdate = await Admin.findById(req.params.id);

    if (!adminToUpdate) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    // Check for duplicate email (if email is being changed)
    if (email && email.toLowerCase() !== adminToUpdate.email) {
      const existingAdmin = await Admin.findOne({
        email: email.toLowerCase(),
        _id: { $ne: req.params.id }
      });

      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use by another admin'
        });
      }
    }

    // Prepare update fields
    const updateFields = {};


    if (email) updateFields.email = email.toLowerCase();
    if (role && req.admin.role === 'superadmin') updateFields.role = role; // Only superadmin can change role
    if (typeof isActive === 'boolean' && req.admin.role === 'superadmin') updateFields.isActive = isActive; // Only superadmin can change active status

    // Handle password update separately
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateFields.password = await bcrypt.hash(password, salt);
    }
    if (name) updateFields.name = name;
    if (accessLevel) updateFields.accessLevel = accessLevel;
    if (phoneNumber) updateFields.phoneNumber = phoneNumber;
    if (countryCode) updateFields.countryCode = countryCode;
    if (cityID) updateFields.cityID = cityID;
    // Check if there's anything to update
    if (Object.keys(updateFields).length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No changes detected',
        data: adminToUpdate
      });
    }

    // Update admin
    const updatedAdmin = await Admin.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    ).select('-refreshToken -__v -password');

    res.status(200).json({
      success: true,
      message: 'Admin updated successfully',
      data: updatedAdmin,
      updated: Object.keys(updateFields)
    });

  } catch (error) {
    console.error('Update admin error:', error);

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin ID format'
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating admin',
      error: error.message
    });
  }
});


/**
 * @route   DELETE /api/admin/:id
 * @desc    Delete admin
 * @access  Private (superadmin only)
 */
router.delete('/:id', authenticateToken, authorizeAdmin, authorizeAccessLevel(0), async (req, res) => {
  try {
    // Prevent deleting yourself
    if (req.admin._id.toString() === req.params.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }

    const admin = await Admin.findById(req.params.id);

    if (admin.role === "superadmin") {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete super admin'
      });
    }

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    // Delete admin from database
    await Admin.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    console.error('Delete admin error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid admin ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error deleting admin',
      error: error.message
    });
  }
});

module.exports = router;