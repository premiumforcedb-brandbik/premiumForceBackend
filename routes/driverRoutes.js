// routes/driverRoutes.js
const express = require('express');
const Driver = require('../models/driver_model');

const AdminAssignDriver = require('../models/assign_admin_driver_model');
const Booking = require('../models/booking_model');

const HourlyBooking = require('../models/hourlyBookingModel');
const Customer = require('../models/users_model');
const DriverOTP = require('../models/driver_otp_model');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const jwt = require('jsonwebtoken');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

const { authenticateDriver } = require('../middleware/driverware');
const twilio = require('twilio');
const mongoose = require('mongoose');
const Fleet = require('../models/FleetModel'); // Added Fleet model
const Zone = require('../models/zoneModel');
const { getAllLiveFleets } = require('../services/afaqyService');

const { notifyUser, notifyUsers } = require('../fcm');


const router = express.Router();

// Initialize Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ============= HELPER FUNCTIONS =============
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const generateAccessToken = (driver) => {
  return jwt.sign(
    {
      driverId: driver._id,
      phoneNumber: driver.phoneNumber,
      role: 'driver'
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
  );
};

const generateRefreshToken = (driver) => {
  return jwt.sign(
    { driverId: driver._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
  );
};

// Middleware to verify driver token
const verifyDriverToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    const driver = await Driver.findById(decoded.driverId).select('-refreshToken -__v');

    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Driver not found'
      });
    }

    if (!driver.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Driver account is deactivated'
      });
    }

    req.driver = driver;
    next();
  } catch (error) {
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
    return res.status(500).json({
      success: false,
      message: 'Error verifying token',
      error: error.message
    });
  }
};





router.post('/:id/driver/fcm-token', async (req, res) => {
  try {
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'fcmToken is required and must be a string.',
      });
    }

    const user = await Driver.findByIdAndUpdate(
      req.params.id,
      { fcmToken },
      { new: true, select: '_id driverName' }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Driver not found.' });
    }

    console.log(`🔔 FCM token saved for user ${user.driverName} (${user._id})`);
    res.json({ success: true, message: 'FCM token registered.' });
  } catch (err) {
    console.error('FCM token route error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});




/**
 * DELETE /api/users/:id/fcm-token
 *
 * Clears the FCM token when the user logs out.
 * Called automatically by the Flutter app on logout.
 */
router.delete('/:id/driver/fcm-token', async (req, res) => {
  try {
    await Driver.findByIdAndUpdate(req.params.id, { fcmToken: null });
    res.json({ success: true, message: 'FCM token cleared.' });
  } catch (err) {
    console.error('FCM token delete error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});




// ============= PUBLIC ROUTES (No Auth Required) =============

/**
 * @route   POST /api/drivers/send-otp
 * @desc    Send OTP for driver login/registration
 * @access  Public
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+966', purpose = 'login' } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const testDrivers = [{
      phoneNumber: '9847801552',
      countryCode: '+91'
    }]


    // For login, check if driver exists
    if (purpose === 'login') {
      const existingDriver = await Driver.findOne({ countryCode, phoneNumber });
      console.log(`Checking driver existence for ${countryCode}${phoneNumber}:`, existingDriver);
      if (!existingDriver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found. Please register first.'
        });
      }
    }

    // Generate OTP
    let otpCode = generateOTP();

    if (testDrivers.some(d => d.phoneNumber === phoneNumber && d.countryCode === countryCode)) {
      otpCode = '123456'
    }

    // Delete any existing unused OTPs for this number
    await DriverOTP.deleteMany({
      phoneNumber,
      countryCode,
      purpose,
      isUsed: false
    });

    // Save new OTP
    await DriverOTP.create({
      phoneNumber,
      countryCode,
      otp: otpCode,
      purpose
    });

    // Send OTP via SMS (Twilio)
    try {
      await twilioClient.messages.create({
        body: `Your driver OTP is: ${otpCode}. Valid for 10 minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `${countryCode}${phoneNumber}`
      });
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
      if (process.env.NODE_ENV === 'production') {
        throw smsError;
      }
    }

    const response = {
      success: true,
      message: 'OTP sent successfully'
    };

    if (process.env.NODE_ENV !== 'production') {
      response.otp = otpCode;
    }

    res.status(200).json(response);
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending OTP',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/drivers/verify-otp
 * @desc    Verify OTP and login/register
 * @access  Public
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { phoneNumber, countryCode = '+966', otp, purpose = 'login' } = req.body;

    // Find valid OTP
    const otpDoc = await DriverOTP.findOne({
      phoneNumber,
      countryCode,
      otp,
      purpose,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Mark OTP as used
    otpDoc.isUsed = true;
    await otpDoc.save();

    let driver;
    let isNewDriver = false;

    if (purpose === 'login') {
      // Login - driver must exist
      driver = await Driver.findOne({ phoneNumber, countryCode });
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found. Please complete registration first.'
        });
      }
    } else if (purpose === 'registration') {
      // Registration - create if not exists
      driver = await Driver.findOne({ phoneNumber, countryCode });
      if (!driver) {
        isNewDriver = true;
        driver = new Driver({
          phoneNumber,
          countryCode,
          driverName: `Driver_${phoneNumber.slice(-4)}`
        });
        await driver.save();
      }
    }

    // Update last login
    driver.lastLogin = new Date();

    // Generate tokens
    const accessToken = generateAccessToken(driver);
    const refreshToken = generateRefreshToken(driver);

    // Save refresh token in database
    driver.refreshToken = refreshToken;
    await driver.save();

    const response = {
      success: true,
      message: isNewDriver ? 'Registration successful' : 'Login successful',
      data: {
        driver: driver.getPublicProfile(),
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
        }
      },
      isNewDriver
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying OTP',
      error: error.message
    });
  }
});



/**
 * @route   PATCH /api/drivers/:id/busy-status
 * @desc    Update driver's busy status (Admin or Driver can update)
 * @access  Private (Admin or Driver)
 */
router.patch('/:id/busy-status',
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isBusy } = req.body;

      // Validate ID format
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid driver ID format'
        });
      }

      // Check if isBusy is provided
      if (isBusy === undefined) {
        return res.status(400).json({
          success: false,
          message: 'isBusy status is required'
        });
      }

      // Find driver
      const driver = await Driver.findById(id);
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found'
        });
      }



      // Update busy status
      const oldStatus = driver.isBusy;
      driver.isBusy = isBusy;


      driver.lastStatusUpdate = new Date();

      await driver.save();

      console.log(`Driver ${driver.driverName} (${id}) busy status updated: ${oldStatus} -> ${driver.isBusy}`);

      res.status(200).json({
        success: true,
        message: driver.isBusy ? 'Driver marked as busy' : 'Driver marked as available',
        data: {
          _id: driver._id,
          driverName: driver.driverName,
          isBusy: driver.isBusy,
          currentBookingId: driver.currentBookingId,
          lastStatusUpdate: driver.lastStatusUpdate,
          isActive: driver.isActive,
          isVerified: driver.isVerified,
          status: driver.isBusy ? 'busy' : 'available'
        }
      });

    } catch (error) {
      console.error('Update driver busy status error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating driver busy status',
        error: error.message
      });
    }
  });


/**
 * @route   GET /api/drivers/list/working
 * @desc    Get list of drivers who have started work (isWorkstarted: true)
 * @access  Private (Admin or Driver)
 */
router.get('/list/working', async (req, res) => {
  try {
    const drivers = await Driver.find({ isWorkstarted: true })
      .select('_id driverName phoneNumber countryCode licenseNumber isWorkstarted isActive')
      .sort({ driverName: 1 });

    res.status(200).json({
      success: true,
      count: drivers.length,
      data: drivers
    });
  } catch (error) {
    console.error('Get working drivers list error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching working drivers list',
      error: error.message
    });
  }
});


/**
 * @route   PATCH /api/drivers/:id/work-status
 * @desc    Set driver's work started status (true or false)
 * @access  Private (Driver or Admin)
 */
router.patch('/:id/work-status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isWorkstarted } = req.body;

    // Validate parameter
    if (typeof isWorkstarted !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isWorkstarted must be a boolean (true or false)'
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      id,
      { isWorkstarted },
      { new: true, runValidators: true }
    ).select('_id driverName isWorkstarted');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.status(200).json({
      success: true,
      message: `Work status updated to ${driver.isWorkstarted}`,
      data: driver
    });
  } catch (error) {
    console.error('Update driver work status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating driver work status',
      error: error.message
    });
  }
});


/**
 * @route   GET /api/drivers/availability/date-wise
 * @desc    Get drivers with their availability status for specific dates
 * @access  Public/Admin (can be used by both)
 */
router.get('/availability/date-wise', async (req, res) => {
  try {
    const {
      date,
      startDate,
      endDate,
      includeDetails = 'true',
      status,
      bookingStatus
    } = req.query;

    // Validate at least one date parameter
    if (!date && !startDate && !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either date or startDate/endDate parameters'
      });
    }

    // Build date range
    let startDateTime = null;
    let endDateTime = null;
    let dateRange = {};

    if (date) {
      startDateTime = new Date(date);
      startDateTime.setHours(0, 0, 0, 0);
      endDateTime = new Date(date);
      endDateTime.setHours(23, 59, 59, 999);
      dateRange = { start: startDateTime, end: endDateTime, type: 'single', date: date };
    } else {
      startDateTime = startDate ? new Date(startDate) : new Date(0);
      endDateTime = endDate ? new Date(endDate) : new Date();
      endDateTime.setHours(23, 59, 59, 999);
      dateRange = { start: startDateTime, end: endDateTime, type: 'range' };
    }

    // Get all active drivers
    const drivers = await Driver.find({ isActive: true })
      .select('-refreshToken -__v')
      .sort({ driverName: 1 });

    // Get all bookings without filtering by driverID in query to avoid CastError
    let hourlyBookings = [];
    let normalBookings = [];

    try {
      // Get all hourly bookings first (no driverID filter in query)
      hourlyBookings = await HourlyBooking.find({});

      // Filter by date if needed
      if (startDateTime && endDateTime) {
        hourlyBookings = hourlyBookings.filter(booking => {
          const bookingDate = booking.pickupDateTime || booking.createdAt;
          return bookingDate && bookingDate >= startDateTime && bookingDate <= endDateTime;
        });
      }

      // Filter by bookingStatus if needed
      if (bookingStatus && bookingStatus !== 'all') {
        hourlyBookings = hourlyBookings.filter(booking =>
          booking.bookingStatus === bookingStatus
        );
      }
    } catch (err) {
      console.error('Error fetching hourly bookings:', err);
    }

    try {
      // Get all normal bookings first (no driverID filter in query)
      normalBookings = await Booking.find({});

      // Filter by date if needed
      if (startDateTime && endDateTime) {
        normalBookings = normalBookings.filter(booking => {
          const bookingDate = booking.arrival || booking.createdAt;
          return bookingDate && bookingDate >= startDateTime && bookingDate <= endDateTime;
        });
      }

      // Filter by bookingStatus if needed
      if (bookingStatus && bookingStatus !== 'all') {
        normalBookings = normalBookings.filter(booking =>
          booking.bookingStatus === bookingStatus
        );
      }
    } catch (err) {
      console.error('Error fetching normal bookings:', err);
    }

    // Map driver availability
    const driverAvailability = drivers.map((driver) => {
      const driverIdStr = driver._id.toString();

      // Find bookings for this driver (filter in JavaScript)
      const driverHourlyBookings = hourlyBookings.filter(b =>
        b.driverID && b.driverID.toString() === driverIdStr
      );

      const driverNormalBookings = normalBookings.filter(b =>
        b.driverID && b.driverID.toString() === driverIdStr
      );

      const allDriverBookings = [...driverHourlyBookings, ...driverNormalBookings];


      const starttrackingBookingsList = allDriverBookings.filter(b =>
        b.bookingStatus === 'starttracking'
      );
      // Separate completed and pending bookings
      // const completedBookingsList = allDriverBookings.filter(b =>
      //   b.bookingStatus === 'starttracking'
      // );

      // const pendingBookingsList = allDriverBookings.filter(b =>
      //   b.bookingStatus === 'pending'
      // );

      // const cancelledBookingsList = allDriverBookings.filter(b =>
      //   b.bookingStatus === 'cancelled'
      // );

      // Check if driver has active booking
      const hasActiveBooking = allDriverBookings.some(booking =>
        ['assigned', 'starttracking', 'stoptracking', 'completed'].includes(booking.bookingStatus)
      );

      const isBusy = driver.isBusy || hasActiveBooking;



      // Get active booking details
      const activeBooking = allDriverBookings.find(booking =>
        ['assigned', 'starttracking', 'stoptracking', 'completed'].includes(booking.bookingStatus)
      );

      // Calculate stats
      const totalBookings = allDriverBookings.length;

      const starttrackingBookings = starttrackingBookingsList.length;
      // const completedBookings = completedBookingsList.length;
      // const pendingBookings = pendingBookingsList.length;
      // const cancelledBookings = cancelledBookingsList.length;

      // const totalEarnings = completedBookingsList.reduce((sum, b) =>
      //   sum + (parseFloat(b.charge) || 0), 0
      // );
      const busyHours = driverHourlyBookings.reduce((sum, b) =>
        sum + (b.hours || 0), 0
      );

      // Build response
      const response = {
        driver: includeDetails === 'true' ? {
          _id: driver._id,
          driverName: driver.driverName,
          phoneNumber: driver.phoneNumber,
          countryCode: driver.countryCode,
          licenseNumber: driver.licenseNumber,
          rating: driver.rating,
          totalTrips: driver.totalTrips,
          earnings: driver.earnings,
          profileImage: driver.profileImage
        } : {
          _id: driver._id,
          driverName: driver.driverName,
          phoneNumber: driver.phoneNumber
        },
        availability: {
          status: isBusy ? 'busy' : 'available',
          isBusy: isBusy,
          isActive: driver.isActive,
          isVerified: driver.isVerified,
          currentBusyStatus: driver.isBusy,
          hasActiveBooking: hasActiveBooking
        },
        stats: {
          totalBookings,
          // completedBookings,
          starttrackingBookings,
          // pendingBookings,
          // cancelledBookings,
          // totalEarnings,
          busyHours
        }
      };





      // Add completed bookings details if requested
      if (bookingStatus === 'starttracking' && includeDetails === 'true'
        && starttrackingBookingsList.length > 0) {
        response.starttrackingBookings = starttrackingBookingsList.map(booking => ({
          id: booking._id,
          type: booking.hours ? 'hourly' : 'normal',
          status: booking.bookingStatus,
          charge: booking.charge,
          hours: booking.hours,
          pickupAddress: booking.pickupAddress || booking.pickupAddress,
          dropOffAddress: booking.dropOffAddress,
          customerID: booking.customerID,
          createdAt: booking.createdAt,
          completedAt: booking.completedAt || booking.updatedAt
        }));
      }


      // Add completed bookings details if requested
      // if (bookingStatus === 'completed' && includeDetails === 'true' && completedBookingsList.length > 0) {
      //   response.completedBookings = completedBookingsList.map(booking => ({
      //     id: booking._id,
      //     type: booking.hours ? 'hourly' : 'normal',
      //     status: booking.bookingStatus,
      //     charge: booking.charge,
      //     hours: booking.hours,
      //     pickupAddress: booking.pickupAddress || booking.pickupAddress,
      //     dropOffAddress: booking.dropOffAddress,
      //     customerID: booking.customerID,
      //     createdAt: booking.createdAt,
      //     completedAt: booking.completedAt || booking.updatedAt
      //   }));
      // }

      // // Add pending bookings details if requested
      // if (bookingStatus === 'pending' && includeDetails === 'true' && pendingBookingsList.length > 0) {
      //   response.pendingBookings = pendingBookingsList.map(booking => ({
      //     id: booking._id,
      //     type: booking.hours ? 'hourly' : 'normal',
      //     status: booking.bookingStatus,
      //     charge: booking.charge,
      //     hours: booking.hours,
      //     pickupAddress: booking.pickupAddress || booking.pickupAddress,
      //     dropOffAddress: booking.dropOffAddress,
      //     customerID: booking.customerID,
      //     createdAt: booking.createdAt
      //   }));
      // }


      // // Add pending bookings details if requested
      // if (bookingStatus === 'cancelled' && includeDetails === 'true' && cancelledBookingsList.length > 0) {
      //   response.cancelledBookings = cancelledBookingsList.map(booking => ({
      //     id: booking._id,
      //     type: booking.hours ? 'hourly' : 'normal',
      //     status: booking.bookingStatus,
      //     charge: booking.charge,
      //     hours: booking.hours,
      //     pickupAddress: booking.pickupAddress || booking.pickupAddress,
      //     dropOffAddress: booking.dropOffAddress,
      //     customerID: booking.customerID,
      //     createdAt: booking.createdAt
      //   }));
      // }


      // Add active booking details if exists
      if (activeBooking && includeDetails === 'true') {
        response.activeBooking = {
          id: activeBooking._id,
          type: activeBooking.hours ? 'hourly' : 'normal',
          status: activeBooking.bookingStatus,
          charge: activeBooking.charge,
          hours: activeBooking.hours,
          pickupAddress: activeBooking.pickupAddress || activeBooking.pickupAddress,
          dropOffAddress: activeBooking.dropOffAddress,
          customerID: activeBooking.customerID,
          createdAt: activeBooking.createdAt
        };
      }

      return response;
    });

    // Apply status filter
    let filteredDrivers = driverAvailability;
    if (status && status !== 'all') {
      filteredDrivers = driverAvailability.filter(d => d.availability.status === status);
    }

    // Calculate summary
    const summary = {
      totalDrivers: drivers.length,
      totalBusyDrivers: driverAvailability.filter(d => d.availability.isBusy).length,
      totalAvailableDrivers: driverAvailability.filter(d => !d.availability.isBusy).length,
      totalActiveDrivers: driverAvailability.filter(d => d.availability.isActive).length,
      totalVerifiedDrivers: driverAvailability.filter(d => d.availability.isVerified).length,
      totalBookings: driverAvailability.reduce((sum, d) => sum + d.stats.totalBookings, 0),
      totalCompletedBookings: driverAvailability.reduce((sum, d) => sum + d.stats.completedBookings, 0),
      totalPendingBookings: driverAvailability.reduce((sum, d) => sum + d.stats.pendingBookings, 0),
      totalstarttrackingBookings: driverAvailability.reduce((sum, d) => sum + d.stats.starttrackingBookings, 0),

      totalEarnings: driverAvailability.reduce((sum, d) => sum + d.stats.totalEarnings, 0),
      totalBusyHours: driverAvailability.reduce((sum, d) => sum + d.stats.busyHours, 0)
    };

    res.status(200).json({
      success: true,
      dateRange,
      filters: { date, startDate, endDate, includeDetails, status, bookingStatus },
      summary,
      groupedByStatus: {
        busy: driverAvailability.filter(d => d.availability.status === 'busy'),
        available: driverAvailability.filter(d => d.availability.status === 'available')
      },
      data: filteredDrivers
    });

  } catch (error) {
    console.error('Error getting driver availability:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver availability',
      error: error.message
    });
  }
});






// Add this temporary route to clean up empty driverID values
router.get('/cleanup-empty-drivers', async (req, res) => {
  try {
    // Clean up HourlyBooking
    const hourlyResult = await HourlyBooking.updateMany(
      { driverID: '' },
      { $set: { driverID: null } }
    );

    // Clean up Booking
    const normalResult = await Booking.updateMany(
      { driverID: '' },
      { $set: { driverID: null } }
    );

    // Also fix any documents with invalid date fields
    const hourlyDateFix = await HourlyBooking.updateMany(
      { pickupDateTime: { $exists: false } },
      { $set: { pickupDateTime: new Date() } }
    );

    const normalDateFix = await Booking.updateMany(
      { arrival: { $exists: false } },
      { $set: { arrival: new Date() } }
    );

    res.json({
      success: true,
      message: 'Cleaned up empty driverID fields and fixed missing dates',
      hourlyBookingsFixed: hourlyResult.modifiedCount,
      normalBookingsFixed: normalResult.modifiedCount,
      hourlyDatesFixed: hourlyDateFix.modifiedCount,
      normalDatesFixed: normalDateFix.modifiedCount
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});











// GET - Get drivers with their hourly bookings for a specific date
router.get('/drivers/hourly-bookings',




  async (req, res) => {
    try {
      const { date, driverId, status, startDate, endDate } = req.query;

      let dateFilter = {};

      if (date) {
        // Single date filter
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        dateFilter.createdAt = {
          $gte: startOfDay,
          $lte: endOfDay
        };
      } else if (startDate || endDate) {
        // Date range filter
        dateFilter.createdAt = {};
        if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
        if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
      }

      // Build hourly booking filter
      const hourlyFilter = { ...dateFilter };
      if (driverId) hourlyFilter.driverID = driverId;
      if (status) hourlyFilter.bookingStatus = status;

      // Get hourly bookings
      const hourlyBookings = await HourlyBooking.find(hourlyFilter)
        .sort({ createdAt: -1 });

      // Group by driver
      const bookingsByDriver = {};

      for (const booking of hourlyBookings) {
        const driverIdStr = booking.driverID;
        if (!driverIdStr || driverIdStr === 'null') continue;

        if (!bookingsByDriver[driverIdStr]) {
          // Get driver details
          const driver = await Driver.findById(driverIdStr);
          if (driver) {
            bookingsByDriver[driverIdStr] = {
              driver: driver.getPublicProfile(),
              bookings: [],
              stats: {
                totalBookings: 0,
                totalEarnings: 0,
                totalHours: 0,
                byStatus: {}
              }
            };
          }
        }

        if (bookingsByDriver[driverIdStr]) {
          bookingsByDriver[driverIdStr].bookings.push(booking);
          bookingsByDriver[driverIdStr].stats.totalBookings++;
          bookingsByDriver[driverIdStr].stats.totalEarnings += booking.charge || 0;
          bookingsByDriver[driverIdStr].stats.totalHours += booking.hours || 0;

          // Status breakdown
          const statusKey = booking.bookingStatus;
          if (!bookingsByDriver[driverIdStr].stats.byStatus[statusKey]) {
            bookingsByDriver[driverIdStr].stats.byStatus[statusKey] = 0;
          }
          bookingsByDriver[driverIdStr].stats.byStatus[statusKey]++;
        }
      }

      const result = Object.values(bookingsByDriver);

      // Calculate totals
      const totals = {
        totalDrivers: result.length,
        totalBookings: hourlyBookings.length,
        totalEarnings: result.reduce((sum, d) => sum + d.stats.totalEarnings, 0),
        totalHours: result.reduce((sum, d) => sum + d.stats.totalHours, 0)
      };

      res.status(200).json({
        success: true,
        filters: { date, startDate, endDate, driverId, status },
        totals,
        data: result
      });

    } catch (error) {
      console.error('Error getting drivers hourly bookings:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  })




// Mark booking as completed by driver, start  tracking veichcle
router.post('/start-tracking/tracking', authenticateDriver, async (req, res) => {
  try {
    const { bookingID } = req.body;
    const driverId = req.driver.driverId;

    // Validate required fields
    if (!bookingID) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    // Find and update booking in one operation
    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingID,
        driverID: driverId,
        bookingStatus: 'assigned'
      },
      {
        $set: {
          bookingStatus: 'starttracking',
          completedAt: new Date()
        }
      },
      { new: true }
    ).select('bookingStatus completedAt pickupLocation dropLocation customerName customerID carName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or you are not authorized to complete it'
      });
    }

    // Update driver stats
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { totalTrips: 1 },
      $set: { lastTripCompletedAt: new Date() }
    });

    console.log(`Booking ${bookingID} marked as completed by driver ${driverId}`);
    console.log('Booking details:', booking);

    // Get driver details for notification
    const driver = await Driver.findById(driverId).select('driverName phoneNumber');



    await driver.setBusy(bookingID);

    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {
      await notifyUser(
        booking.customerID,
        '✅ Tracking started!',
        `Your Driver  is on the way to pickup You`,
        {
          type: 'start tracking',
          bookingId: bookingID.toString(),
          status: 'start tracking',
          completedAt: booking.completedAt,
          bookingDetails: {
            pickupLocation: booking.pickupLocation,
            dropLocation: booking.dropLocation,
            carName: booking.carName,
            customerName: customer?.name,
            driverName: driver?.driverName,
            driverPhone: driver?.phoneNumber
          }
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Tracking started successfully',
      data: {
        bookingId: booking._id,
        status: booking.bookingStatus,
        completedAt: booking.completedAt,
        bookingDetails: {
          pickupLocation: booking.pickupLocation,
          dropLocation: booking.dropLocation,
          carName: booking.carName,
          customerName: customer?.name || booking.customerName
        },
        driver: {
          id: driverId,
          name: driver?.driverName,
          phone: driver?.phoneNumber,
          totalTrips: driver?.totalTrips ? driver.totalTrips + 1 : 1
        }
      }
    });

  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing booking',
      error: error.message
    });
  }
});



// Mark booking as completed by driver
router.post('/start-tracking/tracking/HourlyBooking', authenticateDriver, async (req, res) => {
  try {
    const { bookingID } = req.body;
    const driverId = req.driver.driverId;

    // Validate required fields
    if (!bookingID) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    // Find and update booking in one operation
    const booking = await HourlyBooking.findOneAndUpdate(
      {
        _id: bookingID,
        driverID: driverId,
        bookingStatus: 'assigned'
      },
      {
        $set: {
          bookingStatus: 'starttracking',
          startedAt: new Date()
        }
      },
      { new: true }

    ).select('bookingStatus completedAt startedAt pickupAddress  customerName customerID carName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or you are not authorized to complete it'
      });
    }

    // Update driver stats
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { totalTrips: 1 },
      $set: { lastTripCompletedAt: new Date() }
    });

    console.log(`Booking ${bookingID} marked as completed by driver ${driverId}`);
    console.log('Booking details:', booking);

    // Get driver details for notification
    const driver = await Driver.findById(driverId).select('driverName phoneNumber');


    await driver.setBusy(bookingID);

    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {
      await notifyUser(
        booking.customerID,
        '✅ Tracking started!',
        `Your Driver  is on the way to pickup You`,
        {
          type: 'start tracking',
          bookingId: bookingID.toString(),
          status: 'start tracking',
          completedAt: booking.completedAt,
          bookingDetails: {
            pickupLocation: booking.pickupAddress,

            carName: booking.carName,
            customerName: customer?.name,
            driverName: driver?.driverName,
            driverPhone: driver?.phoneNumber
          }
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Tracking started successfully',
      data: {
        bookingId: booking._id,
        status: booking.bookingStatus,
        completedAt: booking.completedAt,
        bookingDetails: {
          pickupLocation: booking.pickupAddress,

          carName: booking.carName,
          customerName: customer?.name || booking.customerName
        },
        driver: {
          id: driverId,
          name: driver?.driverName,
          phone: driver?.phoneNumber,
          totalTrips: driver?.totalTrips ? driver.totalTrips + 1 : 1
        }
      }
    });

  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing booking',
      error: error.message
    });
  }
});



// Mark booking as completed by driver,stop tracking normal booking
router.post('/complete-trip', authenticateDriver, async (req, res) => {
  try {
    const { bookingID } = req.body;
    const driverId = req.driver.driverId;

    // Validate required fields
    if (!bookingID) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID is required'
      });
    }

    // Find and update booking in one operation
    const booking = await Booking.findOneAndUpdate(
      {
        _id: bookingID,
        driverID: driverId,
        bookingStatus: 'starttracking'
      },
      {
        $set: {
          bookingStatus: 'completed',
          completedAt: new Date()
        }
      },
      { new: true }
    ).select('bookingStatus completedAt pickupLocation dropLocation customerName customerID carName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or you are not authorized to complete it'
      });
    }

    // Update driver stats
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { totalTrips: 1 },
      $set: { lastTripCompletedAt: new Date() }
    });

    console.log(`Booking ${bookingID} marked as completed by driver ${driverId}`);
    console.log('Booking details:', booking);

    // Get driver details for notification
    const driver = await Driver.findById(driverId).select('driverName phoneNumber');


    // Mark driver as available after trip completion
    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {


      await booking.updateStatus('completed');

      // Update driver as busy
      await driver.setFree(bookingID);


      await notifyUser(
        booking.customerID,
        '✅ Trip Completed!',
        ` Thank you for your riding with us.Please rate your experience`,
        {

          type: 'booking_completed',
          bookingId: bookingID.toString(),
          status: 'completed',
          completedAt: booking.completedAt,
          bookingDetails: {
            pickupLocation: booking.pickupLocation,
            dropLocation: booking.dropLocation,
            carName: booking.carName,
            customerName: customer?.name,
            driverName: driver?.driverName,
            driverPhone: driver?.phoneNumber
          }
        }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Trip completed successfully',
      data: {
        bookingId: booking._id,
        status: booking.bookingStatus,
        completedAt: booking.completedAt,
        bookingDetails: {
          pickupLocation: booking.pickupLocation,
          dropLocation: booking.dropLocation,
          carName: booking.carName,
          customerName: customer?.name || booking.customerName
        },
        driver: {
          id: driverId,
          name: driver?.driverName,
          phone: driver?.phoneNumber,
          totalTrips: driver?.totalTrips ? driver.totalTrips + 1 : 1
        }
      }
    });

  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing booking',
      error: error.message
    });
  }
});




// Mark booking as completed by driver, hourly booking stop tracking
router.post('/complete-trip/HourlyBooking',
  authenticateDriver,
  async (req, res) => {
    try {
      const { bookingID } = req.body;
      const driverId = req.driver.driverId;

      // Validate required fields
      if (!bookingID) {
        return res.status(400).json({
          success: false,
          message: 'Booking ID is required'
        });
      }

      // Find and update booking in one operation
      const booking = await HourlyBooking.findOneAndUpdate(
        {
          _id: bookingID,
          driverID: driverId,
          bookingStatus: 'starttracking'
        },
        {
          $set: {
            bookingStatus: 'stoptracking',
            stoppedAt: new Date()
          }
        },
        { new: true }
      ).select('bookingStatus completedAt stoppedAt startedAt hours extraHours pickupAddress dropOffAddress customerName customerID carName charge');

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found or you are not authorized to complete it'
        });
      }



      console.log(`Booking ${bookingID} marked as stopped tracking by driver ${driverId}`);
      console.log('Booking details:', booking);

      // Get driver details for notification
      const driver = await Driver.findById(driverId).select('driverName phoneNumber');

      // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
      const customer = await Customer.findById(booking.customerID).select('name email phone');

      // Send notification to customer (if notifyUser function exists)
      if (typeof notifyUser === 'function') {



        // Update driver as busy
        await driver.setFree(bookingID);


        console.log('Calculating actual hours worked and extra hours if any...', booking.startedAt, booking.stoppedAt);

        // Calculate actual hours worked
        let calculatedExtraHours = 0;
        if (booking.startedAt && booking.stoppedAt) {
          const actualMilliseconds = booking.stoppedAt - booking.startedAt;
          const actualHours = actualMilliseconds / (1000 * 60 * 60); // Convert to hours

          // Calculate extra hours if actual hours exceed booked hours
          calculatedExtraHours = Math.max(0, actualHours - (booking.hours || 0));

          // Update extra hours in the booking
          await HourlyBooking.findByIdAndUpdate(bookingID, {
            $set: { extraHours: calculatedExtraHours }
          });

          console.log(`Booking ${bookingID}: Booked hours: ${booking.hours}, Actual hours: ${actualHours.toFixed(2)}, Extra hours: ${calculatedExtraHours.toFixed(2)}`);
        }

        // Check if extra hours require payment
        if (calculatedExtraHours > 0) {
          // Update booking status to paymentPending
          await HourlyBooking.findByIdAndUpdate(bookingID, {
            $set: { bookingStatus: 'paymentPending' }
          });

          res.status(200).json({
            success: true,
            message: 'The Payment is pending for extra hours, please proceed to payment to complete the trip',
            data: {
              bookingId: booking._id,
              status: 'paymentPending',
              completedAt: booking.completedAt,
              bookingDetails: {
                pickupLocation: booking.pickupAddress,
                carName: booking.carName,
                customerName: customer?.name || booking.customerName
              },
              driver: {
                id: driverId,
                name: driver?.driverName,
                phone: driver?.phoneNumber,
                totalTrips: driver?.totalTrips ? driver.totalTrips + 1 : 1
              }
            }
          });

          await notifyUser(
            booking.customerID,
            '✅ Action Required!',
            'Extra hours detected . Balance SAR ${booking.extraPayment} is pending for ${booking.extraHours}hours'
            ,
            {

              type: 'paymentPending',
              bookingId: bookingID.toString(),
              status: 'paymentPending',
              completedAt: booking.completedAt,
              bookingDetails: {
                pickupLocation: booking.pickupAddress,
                carName: booking.carName,
                customerName: customer?.name,
                driverName: driver?.driverName,
                driverPhone: driver?.phoneNumber
              }
            }
          );
        } else {
          // No extra hours, complete the trip
          // Update driver stats
          await Driver.findByIdAndUpdate(driverId, {
            $inc: { totalTrips: 1 },
            $set: { lastTripCompletedAt: new Date() }
          });

          // Update booking status to completed
          await HourlyBooking.findByIdAndUpdate(bookingID, {
            $set: { bookingStatus: 'completed' }
          });

          res.status(200).json({
            success: true,
            message: 'Trip completed successfully',
            data: {
              bookingId: booking._id,
              status: 'completed',
              completedAt: booking.completedAt,
              bookingDetails: {
                pickupLocation: booking.pickupAddress,
                carName: booking.carName,
                customerName: customer?.name || booking.customerName
              },
              driver: {
                id: driverId,
                name: driver?.driverName,
                phone: driver?.phoneNumber,
                totalTrips: driver?.totalTrips ? driver.totalTrips + 1 : 1
              }
            }
          });


          await notifyUser(
            booking.customerID,
            '✅ Trip Completed',
            `Your Trip has been completed successfully. Thank you for choosing our service!.Please review your experience`,
            {
              type: 'booking_completed',
              bookingId: bookingID.toString(),
              status: 'completed',
              completedAt: booking.completedAt,
              bookingDetails: {
                pickupLocation: booking.pickupAddress,
                carName: booking.carName,
                customerName: customer?.name,
                driverName: driver?.driverName,
                driverPhone: driver?.phoneNumber
              }
            }
          );
        }

      }

    } catch (error) {
      console.error('Complete booking error:', error);
      res.status(500).json({
        success: false,
        message: 'Error completing booking',
        error: error.message
      });
    }
  });




// ============= ADMIN ROUTES (Admin Auth Required) =============

/**
 * @route   GET /api/drivers/all
 * @desc    Get all drivers with pagination (Admin only)
 * @access  Private (Admin)
 */
router.get('/all',
  authenticateToken,
  authorizeAdmin,
  async (req, res) => {

    try {
      const {
        isActive,
        isVerified,
        status,
        search,
        page = 1,
        limit = 10
      } = req.query;

      // Build query
      const query = {};

      if (isActive !== undefined && isActive !== '') {
        query.isActive = isActive === 'true';
      }

      if (isVerified !== undefined && isVerified !== '') {
        query.isVerified = isVerified === 'true';
      }

      // Handle status filtering
      if (status) {
        const statusLabel = status.toLowerCase();
        if (statusLabel === 'idle' || statusLabel === 'ideal') {
          query.isWorkstarted = true;
          query.isBusy = false;
        } else if (statusLabel === 'in-trip') {
          query.isWorkstarted = true;
          query.isBusy = true;
        } else if (statusLabel === 'offline') {
          query.isWorkstarted = false || null;

        }
      }




      if (search && search.trim() !== '') {
        query.$or = [
          { driverName: { $regex: search.trim(), $options: 'i' } },
          { phoneNumber: { $regex: search.trim(), $options: 'i' } },
          { licenseNumber: { $regex: search.trim(), $options: 'i' } }
        ];
      }

      // Pagination
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const skip = (pageNum - 1) * limitNum;

      // ── Dispatcher city-scoping ──────────────────────────────────────────
      // If the admin is a dispatcher (accessLevel === 1), restrict results to
      // drivers whose assigned fleet vehicle is currently inside the dispatcher's
      // city zones (resolved via Afaqy live GPS → Zone polygon → Fleet.driverID).
      if (req.admin?.accessLevel === 1) {
        const cityID = req.admin.cityID?._id || req.admin.cityID;

        if (!cityID) {
          return res.status(403).json({
            success: false,
            message: 'Dispatcher has no city assigned'
          });
        }

        // 1. Get active zones for this city
        const zones = await Zone.find({ cityID, isActive: true });

        if (!zones.length) {
          // No zones defined for city → no visibility
          return res.status(200).json({
            success: true,
            data: [],
            pagination: { page: parseInt(page), limit: limitNum, total: 0, totalPages: 0 }
          });
        }

        // 2. Fetch all live Afaqy fleet units
        const afaqyUnits = await getAllLiveFleets();

        // 3. Filter units whose GPS falls inside any zone of this city
        const cityPlates = afaqyUnits
          .filter(unit => {
            const lat = unit.last_update?.lat;
            const lng = unit.last_update?.lng;
            if (!lat || !lng) return false;
            return zones.some(z => z.containsPoint(lat, lng));
          })
          .map(unit => unit.name.trim());

        // 4. Find Fleet records that match those plates and have a driver assigned
        const cityFleets = await Fleet.find({
          carLicenseNumber: { $in: cityPlates },
          driverID: { $ne: null }
        }).select('driverID');

        const allowedDriverIds = [...new Set(cityFleets.map(f => f.driverID.toString()))];

        // 5. Scope the main query to only those driver IDs
        query._id = { $in: allowedDriverIds };
      }
      // ────────────────────────────────────────────────────────────────────────

      // Get total count
      const total = await Driver.countDocuments(query);
      console.log('Total drivers matching query:', total);

      // Get drivers with pagination
      const driversList = await Driver.find(query)
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNum)
        .select('-refreshToken -__v');

      // Add Fleet details and Status label
      const driversEnhanced = await Promise.all(driversList.map(async (driver) => {
        const driverObj = driver.toObject();

        // Look for current Fleet assignment
        const fleetRecord = await Fleet.findOne({ driverID: driver._id })
          .populate('carID')
          .populate('driverID', 'driverName phoneNumber');

        let calculatedStatus = 'offline';
        if (driverObj.isWorkstarted === true && driverObj.isBusy === false) {
          calculatedStatus = 'idle';
        } else if (driverObj.isWorkstarted === true && driverObj.isBusy === true) {
          calculatedStatus = 'in-trip';
        } else if (driverObj.isWorkstarted === false) {
          calculatedStatus = 'offline';
        }

        return {
          ...driverObj,
          status: calculatedStatus,
          fleet: fleetRecord ? fleetRecord : null
        };
      }));


      console.log('Drivers returned:', driversEnhanced.length);


      // Calculate pagination info
      const totalPages = Math.ceil(total / limitNum);

      res.status(200).json({
        success: true,
        data: driversEnhanced,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1
        }
      });


    } catch (error) {
      console.error('Fetch drivers error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

/**
 * @route   GET /api/drivers/status/:status==
 * @desc    Get drivers by status (idle, in-trip, offline)
 * @access  Private (Admin)
 */
router.get('/',

  authenticateToken,
  authorizeAdmin,
  async (req, res) => {
    try {
      // const { status } = req.body;
      const { search, status, page = 1, limit = 10 } = req.query;

      let query = {};
      let statusLabel = status.toLowerCase();

      // Set query filters based on status parameter
      if (statusLabel === 'idle' || statusLabel === 'ideal') {
        query = { isWorkstarted: true, isBusy: false };
        statusLabel = 'idle'; // Normalize label
      } else if (statusLabel === 'in-trip') {
        query = { isWorkstarted: true, isBusy: true };
      } else if (statusLabel === 'offline') {
        query = { isWorkstarted: false };
      } else {
        return res.status(400).json({ success: false, message: 'Invalid status. Use idle, in-trip, or offline.' });
      }


      if (search && search.trim() !== '') {
        query.$or = [
          { driverName: { $regex: search.trim(), $options: 'i' } },
          { phoneNumber: { $regex: search.trim(), $options: 'i' } }
        ];
      }

      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const skip = (pageNum - 1) * limitNum;

      const total = await Driver.countDocuments(query);
      const drivers = await Driver.find(query)
        .sort('-createdAt')
        .skip(skip)
        .limit(limitNum)
        .select('-refreshToken -__v');

      const data = await Promise.all(drivers.map(async (driver) => {
        const driverObj = driver.toObject();

        // Exact mapping as seen in /all route
        const fleet = await Fleet.findOne({ driverID: driver._id })
          .populate('carID')
          .populate('driverID', 'driverName phoneNumber');

        return {
          ...driverObj,
          status: statusLabel,
          fleet: fleet || null
        };
      }));

      res.status(200).json({
        success: true,
        data,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      console.error(`Fetch drivers by status (${req.params.status}) error:`, error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

/**
 * @route   GET /api/drivers/stats
 * @desc    Get driver statistics (Admin only)
 * @access  Private (Admin)
 */
router.get('/stats', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const stats = await Driver.aggregate([
      {
        $group: {
          _id: null,
          totalDrivers: { $sum: 1 },
          activeDrivers: { $sum: { $cond: ['$isActive', 1, 0] } },
          verifiedDrivers: { $sum: { $cond: ['$isVerified', 1, 0] } },
          averageRating: { $avg: '$rating' },
          totalEarnings: { $sum: '$earnings' },
          totalTrips: { $sum: '$totalTrips' }
        }
      }
    ]);

    res.json({
      success: true,
      data: stats[0] || {
        totalDrivers: 0,
        activeDrivers: 0,
        verifiedDrivers: 0,
        averageRating: 0,
        totalEarnings: 0,
        totalTrips: 0
      }
    });
  } catch (error) {
    console.error('Driver stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/drivers/:id
 * @desc    Get driver by ID (Admin only)
 * @access  Private (Admin)
 */
router.get('/:id', async (req, res) => {
  console.log('🔍 Getting driver by ID:', req.params.id);

  try {
    // Check if ID is valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format'
      });
    }

    const driver = await Driver.findById(req.params.id);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Calculate status label
    const driverObj = driver.toObject();

    // Look for current Fleet assignment
    const fleetRecord = await Fleet.findOne({ driverID: driver._id })
      .populate('carID')
      .populate('driverID', 'driverName phoneNumber');

    let calculatedStatus = 'offline';
    if (driverObj.isWorkstarted === true && driverObj.isBusy === false) {
      calculatedStatus = 'idle';
    } else if (driverObj.isWorkstarted === true && driverObj.isBusy === true) {
      calculatedStatus = 'in-trip';
    } else if (driverObj.isWorkstarted === false) {
      calculatedStatus = 'offline';
    }

    res.json({
      success: true,
      data: {
        ...driverObj,
        status: calculatedStatus,
        fleet: fleetRecord ? fleetRecord : null
      }
    });
  } catch (error) {
    console.error('Fetch driver error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * @route   GET /api/drivers/phone/:phoneNumber
 * @desc    Get driver by phone number (Admin only)
 * @access  Private (Admin)
 */
router.get('/phone/:phoneNumber', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { countryCode = '+966' } = req.query;

    const driver = await Driver.findOne({
      phoneNumber: req.params.phoneNumber,
      countryCode
    }).select('-refreshToken -__v');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    res.status(200).json({
      success: true,
      data: driver
    });
  } catch (error) {
    console.error('Fetch driver by phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver',
      error: error.message
    });
  }
});

// ============= DRIVER ROUTES (Driver Auth Required) =============

/**
 * @route   GET /api/drivers/profile/me
 * @desc    Get current driver profile
 * @access  Private (Driver)
 */
router.get('/profile/me', verifyDriverToken, async (req, res) => {
  try {
    const driverData = req.driver.toObject();

    // Check if driver currently has a vehicle taken out
    const activeFleet = await Fleet.findOne({
      driverID: driverData._id,
      isBusyCar: true
    }).populate('carID');

    res.status(200).json({
      success: true,
      data: {
        ...driverData,
        hasActiveVehicle: !!activeFleet,
        activeVehicle: activeFleet || null
      }
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




router.post('/register',
  authenticateToken,
  authorizeAdmin,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'licenseImage', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      console.log('📝 Create driver request received');
      console.log('Body:', req.body);
      console.log('Files:', req.files ? Object.keys(req.files) : 'No files');

      const {
        driverName,
        phoneNumber,
        countryCode = '+966',
        licenseNumber,
        isVerified = false,
        isActive = true,
        rating = 0,
        totalTrips = 0,
        earnings = 0
      } = req.body;

      // Validate required fields
      const missingFields = [];
      if (!driverName) missingFields.push('driverName');
      if (!phoneNumber) missingFields.push('phoneNumber');
      if (!licenseNumber) missingFields.push('licenseNumber');

      if (missingFields.length > 0) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: `Missing required fields: ${missingFields.join(', ')}`
        });
      }

      // Clean inputs
      const cleanPhoneNumber = phoneNumber.toString().trim();
      const cleanLicenseNumber = licenseNumber.toString().trim();
      const cleanDriverName = driverName.toString().trim();

      // Validate phone number format
      const phoneRegex = /^[0-9]{9,15}$/;
      if (!phoneRegex.test(cleanPhoneNumber)) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format. Must be 9-15 digits.',
          field: 'phoneNumber'
        });
      }

      // Validate license number
      if (cleanLicenseNumber.length < 3) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: 'License number must be at least 3 characters long',
          field: 'licenseNumber'
        });
      }

      // ========== CRITICAL: First, delete all null license records ==========
      const nullLicenseResult = await Driver.deleteMany({
        $or: [
          { licenseNumber: null },
          { licenseNumber: { $exists: false } },
          { licenseNumber: "" },
          { licenseNumber: "null" },
          { licenseNumber: "undefined" },
          { licenseNumber: /^\s*$/ }
        ]
      });

      if (nullLicenseResult.deletedCount > 0) {
        console.log(`🗑️ Deleted ${nullLicenseResult.deletedCount} drivers with null/empty licenses`);
      }
      // ========== END CLEANUP ==========

      // Check for existing driver with same license number
      const existingDriverByLicense = await Driver.findOne({
        licenseNumber: cleanLicenseNumber
      });

      if (existingDriverByLicense) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: `Driver with license number "${cleanLicenseNumber}" already exists`,
          field: 'licenseNumber',
          existingDriver: {
            id: existingDriverByLicense._id,
            name: existingDriverByLicense.driverName,
            phone: existingDriverByLicense.phoneNumber
          }
        });
      }

      // Check for existing driver with same phone number
      const existingDriverByPhone = await Driver.findOne({
        phoneNumber: cleanPhoneNumber,
        countryCode
      });

      if (existingDriverByPhone) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: `Driver with phone number ${countryCode}${cleanPhoneNumber} already exists`,
          field: 'phoneNumber',
          existingDriver: {
            id: existingDriverByPhone._id,
            name: existingDriverByPhone.driverName,
            license: existingDriverByPhone.licenseNumber
          }
        });
      }

      // Check if license image is uploaded
      if (!req.files || !req.files.licenseImage || req.files.licenseImage.length === 0) {
        if (req.files && req.files.profileImage && req.files.profileImage[0]) {
          await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: 'License image is required',
          field: 'licenseImage'
        });
      }

      // Prepare driver data
      const driverData = {
        driverName: cleanDriverName,
        countryCode: countryCode.trim(),
        phoneNumber: cleanPhoneNumber,
        licenseNumber: cleanLicenseNumber, // Make sure this is never null
        licenseImage: {
          key: req.files.licenseImage[0].key,
          url: getS3Url(req.files.licenseImage[0].key),
          originalName: req.files.licenseImage[0].originalname,
          mimeType: req.files.licenseImage[0].mimetype,
          size: req.files.licenseImage[0].size
        },
        isVerified: isVerified === 'true' || isVerified === true,
        isActive: isActive === 'true' || isActive === true,
        rating: parseFloat(rating) || 0,
        totalTrips: parseInt(totalTrips) || 0,
        earnings: parseFloat(earnings) || 0
      };

      // Add profile image if uploaded
      if (req.files.profileImage && req.files.profileImage[0]) {
        driverData.profileImage = {
          key: req.files.profileImage[0].key,
          url: getS3Url(req.files.profileImage[0].key),
          originalName: req.files.profileImage[0].originalname,
          mimeType: req.files.profileImage[0].mimetype,
          size: req.files.profileImage[0].size
        };
      }

      console.log('Creating new driver with data:', {
        driverName: driverData.driverName,
        phoneNumber: driverData.phoneNumber,
        licenseNumber: driverData.licenseNumber,
        hasProfileImage: !!driverData.profileImage,
        hasLicenseImage: true
      });

      // Create new driver
      const newDriver = new Driver(driverData);
      const savedDriver = await newDriver.save();

      console.log('✅ Driver created successfully:', savedDriver._id);

      // Generate tokens for the new driver
      const accessToken = generateAccessToken(savedDriver);
      const refreshToken = generateRefreshToken(savedDriver);

      savedDriver.refreshToken = refreshToken;
      await savedDriver.save();

      const driverProfile = savedDriver.getPublicProfile();

      res.status(201).json({
        success: true,
        message: 'Driver created successfully',
        data: {
          driver: driverProfile,
          tokens: {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
          }
        }
      });

    } catch (error) {
      console.error('❌ Create driver error:', error);

      // Delete uploaded files if error occurs
      if (req.files) {
        if (req.files.profileImage && req.files.profileImage[0]) {
          await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
        }
        if (req.files.licenseImage && req.files.licenseImage[0]) {
          await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }
      }

      // Handle duplicate key error
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];

        // Special message for license field
        if (field === 'licenseNumber') {
          return res.status(400).json({
            success: false,
            message: 'License number already exists. Please use a different license number.',
            field: 'licenseNumber',
            errorCode: 'DUPLICATE_LICENSE',
            suggestion: 'Use a unique license number or contact admin to clean up old records'
          });
        }

        if (field === 'phoneNumber') {
          return res.status(400).json({
            success: false,
            message: 'Phone number already exists. Please use a different phone number.',
            field: 'phoneNumber',
            errorCode: 'DUPLICATE_PHONE'
          });
        }

        return res.status(400).json({
          success: false,
          message: `Driver with this ${field} already exists`,
          field: field,
          errorCode: 'DUPLICATE_KEY'
        });
      }

      // Handle validation errors
      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }

        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors,
          errorCode: 'VALIDATION_ERROR'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error creating driver',
        error: error.message,
        errorCode: 'SERVER_ERROR'
      });
    }
  }
);

// ============= UPDATE DRIVER (PUT) =============

router.put('/:id',
  authenticateToken,
  authorizeAdmin,
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'licenseImage', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`📝 Update driver request for ID: ${id}`);
      console.log('Body:', req.body);
      console.log('Files:', req.files ? Object.keys(req.files) : 'No files');

      // Validate ID format
      if (!mongoose.Types.ObjectId.isValid(id)) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: 'Invalid driver ID format'
        });
      }

      // Find existing driver
      const existingDriver = await Driver.findById(id);
      if (!existingDriver) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(404).json({
          success: false,
          message: 'Driver not found'
        });
      }

      // Extract fields from request body
      const {
        driverName,
        phoneNumber,
        countryCode,
        licenseNumber,
        isVerified,
        isActive,
        isBusy,
        rating,
        totalTrips,
        earnings
      } = req.body;

      // Prepare update data
      const updateData = {};

      // Update driver name if provided
      if (driverName && driverName !== existingDriver.driverName) {
        updateData.driverName = driverName.toString().trim();
      }

      // Update country code if provided
      if (countryCode && countryCode !== existingDriver.countryCode) {
        updateData.countryCode = countryCode.trim();
      }

      // Update phone number if provided
      if (phoneNumber && phoneNumber !== existingDriver.phoneNumber) {
        const cleanPhoneNumber = phoneNumber.toString().trim();

        // Validate phone number format
        const phoneRegex = /^[0-9]{9,15}$/;
        if (!phoneRegex.test(cleanPhoneNumber)) {
          if (req.files) {
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
          }

          return res.status(400).json({
            success: false,
            message: 'Invalid phone number format. Must be 9-15 digits.',
            field: 'phoneNumber'
          });
        }

        // Check if new phone number already exists
        const phoneExists = await Driver.findOne({
          phoneNumber: cleanPhoneNumber,
          countryCode: updateData.countryCode || existingDriver.countryCode,
          _id: { $ne: id }
        });

        if (phoneExists) {
          if (req.files) {
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
          }

          return res.status(400).json({
            success: false,
            message: `Phone number ${updateData.countryCode || existingDriver.countryCode}${cleanPhoneNumber} is already in use by driver: ${phoneExists.driverName}`,
            field: 'phoneNumber'
          });
        }

        updateData.phoneNumber = cleanPhoneNumber;
      }

      // Update license number if provided
      if (licenseNumber && licenseNumber !== existingDriver.licenseNumber) {
        const cleanLicenseNumber = licenseNumber.toString().trim();

        if (cleanLicenseNumber.length < 3) {
          if (req.files) {
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
          }

          return res.status(400).json({
            success: false,
            message: 'License number must be at least 3 characters long',
            field: 'licenseNumber'
          });
        }

        // Check if new license number already exists
        const licenseExists = await Driver.findOne({
          licenseNumber: cleanLicenseNumber,
          _id: { $ne: id }
        });

        if (licenseExists) {
          if (req.files) {
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
          }

          return res.status(400).json({
            success: false,
            message: `License number "${cleanLicenseNumber}" is already in use by driver: ${licenseExists.driverName}`,
            field: 'licenseNumber'
          });
        }

        updateData.licenseNumber = cleanLicenseNumber;
      }

      // Update boolean fields
      if (isVerified !== undefined) {
        updateData.isVerified = isVerified === 'true' || isVerified === true;
      }

      if (isActive !== undefined) {
        updateData.isActive = isActive === 'true' || isActive === true;
      }

      if (isBusy !== undefined) {
        updateData.isBusy = isBusy === 'true' || isBusy === true;
      }

      // Update numeric fields
      if (rating !== undefined && !isNaN(parseFloat(rating))) {
        const newRating = parseFloat(rating);
        if (newRating >= 0 && newRating <= 5) {
          updateData.rating = newRating;
        }
      }

      if (totalTrips !== undefined && !isNaN(parseInt(totalTrips))) {
        updateData.totalTrips = parseInt(totalTrips);
      }

      if (earnings !== undefined && !isNaN(parseFloat(earnings))) {
        updateData.earnings = parseFloat(earnings);
      }

      // Handle profile image update
      if (req.files && req.files.profileImage && req.files.profileImage[0]) {
        try {
          // Delete old profile image from S3 if exists
          if (existingDriver.profileImage?.key) {
            await deleteFromS3(existingDriver.profileImage.key).catch(err =>
              console.error('Error deleting old profile image:', err)
            );
          }

          // Set new profile image
          updateData.profileImage = {
            key: req.files.profileImage[0].key,
            url: getS3Url(req.files.profileImage[0].key),
            originalName: req.files.profileImage[0].originalname,
            mimeType: req.files.profileImage[0].mimetype,
            size: req.files.profileImage[0].size
          };
          console.log('🖼️ Profile image updated');
        } catch (imageError) {
          console.error('Error processing profile image:', imageError);
        }
      }

      // Handle license image update
      if (req.files && req.files.licenseImage && req.files.licenseImage[0]) {
        try {
          // Delete old license image from S3 if exists
          if (existingDriver.licenseImage?.key) {
            await deleteFromS3(existingDriver.licenseImage.key).catch(err =>
              console.error('Error deleting old license image:', err)
            );
          }

          // Set new license image
          updateData.licenseImage = {
            key: req.files.licenseImage[0].key,
            url: getS3Url(req.files.licenseImage[0].key),
            originalName: req.files.licenseImage[0].originalname,
            mimeType: req.files.licenseImage[0].mimetype,
            size: req.files.licenseImage[0].size
          };
          console.log('📄 License image updated');
        } catch (imageError) {
          console.error('Error processing license image:', imageError);
        }
      }

      // Check if there's anything to update
      if (Object.keys(updateData).length === 0) {
        if (req.files) {
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }

        return res.status(400).json({
          success: false,
          message: 'No valid fields to update'
        });
      }

      console.log('Updating driver with data:', updateData);

      // Update the driver
      const updatedDriver = await Driver.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true }
      ).select('-refreshToken -__v');

      if (!updatedDriver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found after update'
        });
      }

      console.log('✅ Driver updated successfully:', updatedDriver._id);

      res.status(200).json({
        success: true,
        message: 'Driver updated successfully',
        data: updatedDriver
      });

    } catch (error) {
      console.error('❌ Update driver error:', error);


      // Delete uploaded files if error occurs
      if (req.files) {
        if (req.files.profileImage && req.files.profileImage[0]) {
          await deleteFromS3(req.files.profileImage[0].key).catch(() => { });
        }
        if (req.files.licenseImage && req.files.licenseImage[0]) {
          await deleteFromS3(req.files.licenseImage[0].key).catch(() => { });
        }
      }

      // Handle duplicate key error
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        let fieldName = field === 'phoneNumber' ? 'phone number' : field;

        return res.status(400).json({
          success: false,
          message: `Driver with this ${fieldName} already exists`,
          field: field,
          errorCode: 'DUPLICATE_KEY'
        });
      }

      // Handle validation errors
      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }

        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors,
          errorCode: 'VALIDATION_ERROR'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating driver',
        error: error.message,
        errorCode: 'SERVER_ERROR'
      });
    }
  }
);



/**
 * @route   POST /api/drivers/refresh-token
 * @desc    Get new access token using refresh token
 * @access  Public
 */
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    const driver = await Driver.findOne({
      _id: decoded.driverId,
      refreshToken: refreshToken
    });

    if (!driver) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    if (!driver.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Driver account is deactivated'
      });
    }

    const newAccessToken = generateAccessToken(driver);
    const newRefreshToken = generateRefreshToken(driver);

    driver.refreshToken = newRefreshToken;
    await driver.save();

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        tokenType: 'Bearer',
        expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/drivers/logout
 * @desc    Logout driver
 * @access  Private (Driver)
 */
router.post('/logout', verifyDriverToken, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      const driver = await Driver.findOne({ refreshToken: refreshToken });
      if (driver) {
        driver.refreshToken = null;
        await driver.save();
      }
    } else {
      req.driver.refreshToken = null;
      await req.driver.save();
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout',
      error: error.message
    });
  }
});



// DELETE /api/airports/:id - Delete airport and associated image
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid diver ID format'
      });
    }

    const driver = await Driver.findById(id);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }


    // Delete image from S3 if exists
    if (driver.image?.key) {
      await deleteFromS3(driver.profileImage.key);

      await deleteFromS3(driver.licenseImage.key);
    }

    await Driver.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Driver deleted successfully'
    });
  } catch (error) {
    console.error('Delete Driver error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting airport',
      error: error.message
    });
  }
});




/**
 * @route   PATCH /api/drivers/location
 * @desc    Update driver location (Driver only)
 * @access  Private (Driver)
 */

router.patch('/location',
  verifyDriverToken,
  async (req, res) => {
    try {
      const { driverLat, driverLong } = req.body;
      // Validate coordinates
      if (driverLat === undefined || driverLong === undefined) {
        return res.status(400).json({
          success: false,
          message: 'driverLat and driverLong are required'
        });
      }
      // Update only the latitude and longitude
      const driver = await Driver.findByIdAndUpdate(
        req.driver._id,
        {
          driverLat,
          driverLong
        },
        { new: true, runValidators: true }
      );
      res.json({
        success: true,
        message: 'Location updated successfully',
        data: driver
      });
    } catch (error) {
      console.error('Update location error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  });

module.exports = router;
