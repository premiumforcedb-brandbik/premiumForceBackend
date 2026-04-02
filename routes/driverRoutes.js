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

const {authenticateDriver} = require('../middleware/driverware');
const twilio = require('twilio');
const mongoose = require('mongoose'); // <-- ADD THIS LINE

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
    const otpCode = generateOTP();

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




// drivers list specific dates api needed
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
      status // 'busy', 'available', 'all'
    } = req.query;

    // Validate at least one date parameter
    if (!date && !startDate && !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide either date or startDate/endDate parameters',
        example: '/api/drivers/availability/date-wise?date=2024-03-24'
      });
    }

    // Build date range for filtering
    let startDateTime = null;
    let endDateTime = null;
    let dateRange = {};

    if (date) {
      // Single date filter
      startDateTime = new Date(date);
      startDateTime.setHours(0, 0, 0, 0);
      endDateTime = new Date(date);
      endDateTime.setHours(23, 59, 59, 999);
      
      dateRange = {
        start: startDateTime,
        end: endDateTime,
        type: 'single',
        date: date
      };
    } else if (startDate || endDate) {
      // Date range filter
      startDateTime = startDate ? new Date(startDate) : new Date(0);
      endDateTime = endDate ? new Date(endDate) : new Date();
      endDateTime.setHours(23, 59, 59, 999);
      
      dateRange = {
        start: startDateTime,
        end: endDateTime,
        type: 'range'
      };
    }

    // Get all active drivers
    const driverQuery = { isActive: true };
    const drivers = await Driver.find(driverQuery)
      .select('-refreshToken -__v')
      .sort({ driverName: 1 });

    // Get all bookings WITHOUT date filter first to avoid CastError
    // Then filter in JavaScript to avoid MongoDB casting issues
    let hourlyBookings = [];
    let normalBookings = [];

    try {
      // Get hourly bookings - handle empty driverID separately
      hourlyBookings = await HourlyBooking.find({
        driverID: { $ne: null, $ne: '', $exists: true }
      });
      
      // Filter by date in JavaScript if date range provided
      if (startDateTime && endDateTime) {
        hourlyBookings = hourlyBookings.filter(booking => {
          const bookingDate = booking.pickupDateTime || booking.createdAt;
          if (!bookingDate) return false;
          return bookingDate >= startDateTime && bookingDate <= endDateTime;
        });
      }
    } catch (err) {
      console.error('Error fetching hourly bookings:', err);
      hourlyBookings = [];
    }

    try {
      // Get normal bookings - handle empty driverID separately
      normalBookings = await Booking.find({
        driverID: { $ne: null, $ne: '', $exists: true }
      });
      
      // Filter by date in JavaScript if date range provided
      if (startDateTime && endDateTime) {
        normalBookings = normalBookings.filter(booking => {
          const bookingDate = booking.arrival || booking.createdAt;
          if (!bookingDate) return false;
          return bookingDate >= startDateTime && bookingDate <= endDateTime;
        });
      }
    } catch (err) {
      console.error('Error fetching normal bookings:', err);
      normalBookings = [];
    }

    // Map driver availability
    const driverAvailability = drivers.map((driver) => {
      const driverIdStr = driver._id.toString();
      
      // Find bookings for this driver
      const driverHourlyBookings = hourlyBookings.filter(b => {
        if (!b.driverID) return false;
        const bookingDriverId = b.driverID.toString();
        return bookingDriverId === driverIdStr;
      });
      
      const driverNormalBookings = normalBookings.filter(b => {
        if (!b.driverID) return false;
        const bookingDriverId = b.driverID.toString();
        return bookingDriverId === driverIdStr;
      });
      
      const allDriverBookings = [...driverHourlyBookings, ...driverNormalBookings];
      
      // Calculate availability status
      const hasActiveBooking = allDriverBookings.some(booking => 
        booking.bookingStatus === 'assigned' ||
        booking.bookingStatus === 'starttrack' ||
        booking.bookingStatus === 'stoptrack' ||
        booking.bookingStatus === 'in-progress' ||
        booking.bookingStatus === 'confirmed'
      );
      
      const isBusy = driver.isBusy || hasActiveBooking;
      
      // Get active booking details
      const activeBooking = allDriverBookings.find(booking => 
        booking.bookingStatus === 'assigned' ||
        booking.bookingStatus === 'starttrack' ||
        booking.bookingStatus === 'stoptrack' ||
        booking.bookingStatus === 'in-progress' ||
        booking.bookingStatus === 'confirmed'
      );
      
      // Calculate total bookings count
      const totalBookings = allDriverBookings.length;
      const completedBookings = allDriverBookings.filter(b => 
        b.bookingStatus === 'completed'
      ).length;
      
      // Calculate total earnings
      const totalEarnings = allDriverBookings.reduce((sum, b) => 
        sum + (parseFloat(b.charge) || 0), 0
      );
      
      // Calculate busy hours (for hourly bookings only)
      const busyHours = driverHourlyBookings.reduce((sum, b) => 
        sum + (b.hours || 0), 0
      );
      
      const availability = {
        status: isBusy ? 'busy' : 'available',
        isBusy: isBusy,
        isActive: driver.isActive,
        isVerified: driver.isVerified,
        currentBusyStatus: driver.isBusy,
        hasActiveBooking: hasActiveBooking
      };
      
      // Build response based on includeDetails flag
      const driverInfo = {
        _id: driver._id,
        driverName: driver.driverName,
        phoneNumber: driver.phoneNumber,
        countryCode: driver.countryCode,
        licenseNumber: driver.licenseNumber,
        rating: driver.rating,
        totalTrips: driver.totalTrips,
        earnings: driver.earnings,
        profileImage: driver.profileImage
      };
      
      const response = {
        driver: includeDetails === 'true' ? driverInfo : { 
          _id: driver._id, 
          driverName: driver.driverName,
          phoneNumber: driver.phoneNumber
        },
        availability,
        stats: {
          totalBookings,
          completedBookings,
          cancelledBookings: allDriverBookings.filter(b => 
            b.bookingStatus === 'cancelled'
          ).length,
          pendingBookings: allDriverBookings.filter(b => 
            b.bookingStatus === 'pending'
          ).length,
          totalEarnings,
          busyHours: busyHours
        }
      };
      
      // Add active booking details if exists and includeDetails is true
      if (activeBooking && includeDetails === 'true') {
        response.activeBooking = {
          id: activeBooking._id,
          type: activeBooking.hours ? 'hourly' : 'normal',
          status: activeBooking.bookingStatus,
          charge: activeBooking.charge,
          ...(activeBooking.hours && { hours: activeBooking.hours }),
          ...(activeBooking.pickupAdddress && { pickupAddress: activeBooking.pickupAdddress }),
          ...(activeBooking.pickupAddress && { pickupAddress: activeBooking.pickupAddress }),
          ...(activeBooking.dropOffAddress && { dropOffAddress: activeBooking.dropOffAddress }),
          customerID: activeBooking.customerID,
          createdAt: activeBooking.createdAt
        };
      }
      
      return response;
    });
    
    // Filter by status if requested
    let filteredDrivers = driverAvailability;
    if (status && status !== 'all') {
      filteredDrivers = driverAvailability.filter(d => 
        d.availability.status === status
      );
    }
    
    // Calculate summary statistics
    const summary = {
      totalDrivers: drivers.length,
      totalBusyDrivers: driverAvailability.filter(d => d.availability.isBusy).length,
      totalAvailableDrivers: driverAvailability.filter(d => !d.availability.isBusy).length,
      totalActiveDrivers: driverAvailability.filter(d => d.availability.isActive).length,
      totalVerifiedDrivers: driverAvailability.filter(d => d.availability.isVerified).length,
      totalBookings: driverAvailability.reduce((sum, d) => sum + d.stats.totalBookings, 0),
      totalEarnings: driverAvailability.reduce((sum, d) => sum + d.stats.totalEarnings, 0),
      totalBusyHours: driverAvailability.reduce((sum, d) => sum + d.stats.busyHours, 0)
    };
    
    // Group by availability status
    const groupedByStatus = {
      busy: driverAvailability.filter(d => d.availability.status === 'busy'),
      available: driverAvailability.filter(d => d.availability.status === 'available')
    };
    
    res.status(200).json({
      success: true,
      dateRange,
      filters: { date, startDate, endDate, includeDetails, status },
      summary,
      groupedByStatus,
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





// Mark booking as completed by driver
router.post('/complete-booking/tracking', authenticateDriver, async (req, res) => {
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
    
    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {
      await notifyUser(
        booking.customerID,
        '✅ Trip started and tracking has begun',
        `Your Trip has tracking started`,
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
router.post('/complete-booking/tracking/HourlyBooking', authenticateDriver, async (req, res) => {
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
          completedAt: new Date()
        }
      },
      { new: true }
    ).select('bookingStatus completedAt pickupAddress  customerName customerID carName');

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
    
    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {
      await notifyUser(
        booking.customerID,
        '✅ Trip started and tracking has begun',
        `Your Trip has tracking started`,
        {
          type: 'start tracking',
          bookingId: bookingID.toString(),
          status: 'start tracking',
          completedAt: booking.completedAt,
          bookingDetails: {
            pickupLocation: booking.pickupAdddress,
      
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
          pickupLocation: booking.pickupAdddress,

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
        bookingStatus: 'assigned'
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
    
    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {


      await booking.updateStatus('completed');
    
    // Update driver as busy
    await driver.setFree(bookingID);


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




// Mark booking as completed by driver
router.post('/complete-trip/HourlyBooking', authenticateDriver, async (req, res) => {
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
    
    // Get customer details for notification - THIS NOW WORKS BECAUSE Customer IS IMPORTED
    const customer = await Customer.findById(booking.customerID).select('name email phone');

    // Send notification to customer (if notifyUser function exists)
    if (typeof notifyUser === 'function') {


      await booking.updateStatus('completed');
    
    // Update driver as busy
    await driver.setFree(bookingID);


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
            pickupLocation: booking.pickupAdddress,
        
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
          pickupLocation: booking.pickupAdddress,
   
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



// ============= ADMIN ROUTES (Admin Auth Required) =============

/**
 * @route   GET /api/drivers/all
 * @desc    Get all drivers with pagination (Admin only)
 * @access  Private (Admin)
 */
router.get('/all', async (req, res) => {
  console.log('🔥🔥🔥 /all ROUTE IS EXECUTING! 🔥🔥🔥');
  
  try {
    const { 
      isActive, 
      isVerified,
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
    
    // Get total count
    const total = await Driver.countDocuments(query);
    console.log('Total drivers matching query:', total);
    
    // Get drivers with pagination
    const drivers = await Driver.find(query)
      .sort('-createdAt')
      .skip(skip)
      .limit(limitNum)
      .select('-refreshToken -__v');

    console.log('Drivers returned:', drivers.length);

    // Calculate pagination info
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      data: drivers,
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
    
    res.json({ 
      success: true, 
      data: driver 
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
    res.status(200).json({
      success: true,
      data: req.driver
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
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
          await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
        }
        if (req.files.licenseImage && req.files.licenseImage[0]) {
          await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
            if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
            if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
          if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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
          await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
        }
        if (req.files.licenseImage && req.files.licenseImage[0]) {
          await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
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





router.get('/debug/all-licenses', async (req, res) => {
  try {
    const drivers = await Driver.find({}, 'driverName phoneNumber licenseNumber isActive');
    
    console.log('All drivers in database:');
    drivers.forEach(driver => {
      console.log(`- ${driver.driverName}: ${driver.licenseNumber}`);
    });
    
    res.status(200).json({
      success: true,
      totalDrivers: drivers.length,
      drivers: drivers.map(d => ({
        id: d._id,
        name: d.driverName,
        phone: d.phoneNumber,
        licenseNumber: d.licenseNumber,
        isActive: d.isActive
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});



// router.put('/:id', authenticateToken, authorizeAdmin, upload.fields([
//   { name: 'profileImage', maxCount: 1 },
//   { name: 'licenseImage', maxCount: 1 }
// ]), async (req, res) => {
//   console.log('🔍 Updating driver with ID:', req.params.id);
//   console.log('Request body:', req.body);
//   console.log('Request files:', req.files);
  
//   try {
//     const { id } = req.params;
    
//     // Check if ID is valid MongoDB ObjectId
//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       // Delete uploaded files if ID is invalid
//       if (req.files) {
//         if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
//         if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
//       }
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Invalid driver ID format' 
//       });
//     }

//     // Find existing driver
//     const existingDriver = await Driver.findById(id);
    
//     if (!existingDriver) {
//       // Delete uploaded files if driver not found
//       if (req.files) {
//         if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
//         if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
//       }
//       return res.status(404).json({
//         success: false,
//         message: 'Driver not found'
//       });
//     }

//     // Extract fields from request body
//     const { 
//       driverName, 
//       phoneNumber,
//       countryCode,
//       licenseNumber,
//       isActive,
//       isVerified,
//       rating
//     } = req.body;

//     // Check phone number uniqueness if being updated
//     if (phoneNumber && (phoneNumber !== existingDriver.phoneNumber || 
//         (countryCode && countryCode !== existingDriver.countryCode))) {
      
//       const phoneQuery = countryCode 
//         ? { phoneNumber, countryCode }
//         : { phoneNumber, countryCode: existingDriver.countryCode };
      
//       const existingPhoneDriver = await Driver.findOne({
//         ...phoneQuery,
//         _id: { $ne: id }
//       });
      
//       if (existingPhoneDriver) {
//         // Delete uploaded files
//         if (req.files) {
//           if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
//           if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Phone number already in use by another driver'
//         });
//       }
//     }

//     // Check license number uniqueness if being updated
//     if (licenseNumber && licenseNumber !== existingDriver.licenseNumber) {
//       const existingLicenseDriver = await Driver.findOne({
//         licenseNumber,
//         _id: { $ne: id }
//       });
      
//       if (existingLicenseDriver) {
//         // Delete uploaded files
//         if (req.files) {
//           if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key);
//           if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key);
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'License number already in use by another driver'
//         });
//       }
//     }

//     // Update basic fields
//     const updateData = {};
    
//     if (driverName) updateData.driverName = driverName;
//     if (phoneNumber) updateData.phoneNumber = phoneNumber;
//     if (countryCode) updateData.countryCode = countryCode;
//     if (licenseNumber) updateData.licenseNumber = licenseNumber;
//     if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;
//     if (isVerified !== undefined) updateData.isVerified = isVerified === 'true' || isVerified === true;
//     if (rating !== undefined && !isNaN(parseFloat(rating))) {
//       updateData.rating = parseFloat(rating);
//     }

//     // Handle profile image update
//     if (req.files && req.files.profileImage && req.files.profileImage[0]) {
//       try {
//         // Delete old profile image from S3 if it exists
//         if (existingDriver.profileImage?.key) {
//           await deleteFromS3(existingDriver.profileImage.key).catch(err => 
//             console.error('Error deleting old profile image:', err)
//           );
//         }
        
//         // Set new profile image
//         updateData.profileImage = {
//           key: req.files.profileImage[0].key,
//           url: getS3Url(req.files.profileImage[0].key),
//           originalName: req.files.profileImage[0].originalname,
//           mimeType: req.files.profileImage[0].mimetype,
//           size: req.files.profileImage[0].size
//         };
//       } catch (imageError) {
//         console.error('Error processing profile image:', imageError);
//       }
//     }

//     // Handle license image update
//     if (req.files && req.files.licenseImage && req.files.licenseImage[0]) {
//       try {
//         // Delete old license image from S3 if it exists
//         if (existingDriver.licenseImage?.key) {
//           await deleteFromS3(existingDriver.licenseImage.key).catch(err => 
//             console.error('Error deleting old license image:', err)
//           );
//         }
        
//         // Set new license image
//         updateData.licenseImage = {
//           key: req.files.licenseImage[0].key,
//           url: getS3Url(req.files.licenseImage[0].key),
//           originalName: req.files.licenseImage[0].originalname,
//           mimeType: req.files.licenseImage[0].mimetype,
//           size: req.files.licenseImage[0].size
//         };
//       } catch (imageError) {
//         console.error('Error processing license image:', imageError);
//       }
//     }

//     // Update the driver
//     const updatedDriver = await Driver.findByIdAndUpdate(
//       id,
//       { $set: updateData },
//       { new: true, runValidators: true }
//     ).select('-refreshToken -__v');

//     console.log('Driver updated successfully:', updatedDriver._id);

//     res.status(200).json({
//       success: true,
//       message: 'Driver updated successfully',
//       data: updatedDriver
//     });

//   } catch (error) {
//     console.error('Update driver error:', error);
    
//     // Clean up uploaded files if error occurs
//     if (req.files) {
//       if (req.files.profileImage) {
//         await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
//       }
//       if (req.files.licenseImage) {
//         await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
//       }
//     }

//     // Handle validation errors
//     if (error.name === 'ValidationError') {
//       const errors = {};
//       for (let field in error.errors) {
//         errors[field] = error.errors[field].message;
//       }
//       return res.status(400).json({
//         success: false,
//         message: 'Validation error',
//         errors: errors
//       });
//     }

//     // Handle duplicate key error
//     if (error.code === 11000) {
//       const field = Object.keys(error.keyPattern)[0];
//       return res.status(400).json({
//         success: false,
//         message: `Driver with this ${field} already exists`,
//         field: field
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Error updating driver',
//       error: error.message
//     });
//   }
// });


// router.post('/register',
//   upload.fields([
//     { name: 'profileImage', maxCount: 1 },
//     { name: 'licenseImage', maxCount: 1 }
//   ]), 
//   async (req, res) => {
//     try {
//       console.log('📝 Driver registration request received');
//       console.log('Body:', req.body);
//       console.log('Files:', req.files ? Object.keys(req.files) : 'No files');

//       const { 
//         driverName, 
//         phoneNumber,
//         countryCode = '+966',
//         licenseNumber,
//         isVerified = false
//       } = req.body;

//       // Validate required fields
//       const missingFields = [];
//       if (!driverName) missingFields.push('driverName');
//       if (!phoneNumber) missingFields.push('phoneNumber');
//       if (!licenseNumber) missingFields.push('licenseNumber');
      
//       if (missingFields.length > 0) {
//         if (req.files) {
//           if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
//           if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
//         }
        
//         return res.status(400).json({
//           success: false,
//           message: `Missing required fields: ${missingFields.join(', ')}`
//         });
//       }

//       // Clean inputs
//       const cleanPhoneNumber = phoneNumber.toString().trim();
//       const cleanLicenseNumber = licenseNumber.toString().trim();
      
//       // Check if license number is valid
//       if (cleanLicenseNumber === '' || cleanLicenseNumber === 'null' || cleanLicenseNumber === 'undefined') {
//         if (req.files) {
//           if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
//           if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
//         }
        
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid license number provided'
//         });
//       }
      
//       // CRITICAL: First, check if there are any documents with null license numbers
//       // and fix them before proceeding
//       const nullLicenseCount = await Driver.countDocuments({
//         $or: [
//           { licenseNumber: null },
//           { licenseNumber: { $exists: false } },
//           { licenseNumber: "" },
//           { licenseNumber: "null" }
//         ]
//       });
      
//       if (nullLicenseCount > 0) {
//         console.log(`⚠️ Found ${nullLicenseCount} drivers with null/empty licenses. Fixing them...`);
        
//         // Auto-fix null licenses
//         const nullLicenseDrivers = await Driver.find({
//           $or: [
//             { licenseNumber: null },
//             { licenseNumber: { $exists: false } },
//             { licenseNumber: "" },
//             { licenseNumber: "null" }
//           ]
//         });
        
//         for (const driver of nullLicenseDrivers) {
//           const tempLicense = `FIXED_${driver._id.toString().slice(-8)}_${Date.now()}`;
//           driver.licenseNumber = tempLicense;
//           await driver.save();
//           console.log(`Fixed driver ${driver._id} with license: ${tempLicense}`);
//         }
        
//         console.log(`✅ Fixed ${nullLicenseCount} drivers with null/empty licenses`);
//       }
      
//       // Now check for existing driver with the same license number
//       const existingDriverByLicense = await Driver.findOne({ 
//         licenseNumber: cleanLicenseNumber 
//       });
      
//       if (existingDriverByLicense) {
//         if (req.files) {
//           if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
//           if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
//         }
        
//         return res.status(400).json({
//           success: false,
//           message: `Driver with license number "${cleanLicenseNumber}" already exists`,
//           field: "licenseNumber",
//           existingDriver: {
//             id: existingDriverByLicense._id,
//             name: existingDriverByLicense.driverName,
//             phone: existingDriverByLicense.phoneNumber
//           }
//         });
//       }
      
//       // Check for existing phone number
//       const existingDriverByPhone = await Driver.findOne({ 
//         phoneNumber: cleanPhoneNumber, 
//         countryCode 
//       });
      
//       if (existingDriverByPhone) {
//         if (req.files) {
//           if (req.files.profileImage) await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
//           if (req.files.licenseImage) await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
//         }
        
//         return res.status(400).json({
//           success: false,
//           message: `Driver with phone number ${countryCode}${cleanPhoneNumber} already exists`,
//           field: "phoneNumber"
//         });
//       }

//       // Check if license image is uploaded
//       if (!req.files || !req.files.licenseImage || req.files.licenseImage.length === 0) {
//         if (req.files && req.files.profileImage && req.files.profileImage[0]) {
//           await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'License image is required'
//         });
//       }

//       // Prepare driver data
//       const driverData = {
//         driverName: driverName.trim(),
//         countryCode: countryCode.trim(),
//         phoneNumber: cleanPhoneNumber,
//         licenseNumber: cleanLicenseNumber,
//         licenseImage: {
//           key: req.files.licenseImage[0].key,
//           url: getS3Url(req.files.licenseImage[0].key),
//           originalName: req.files.licenseImage[0].originalname,
//           mimeType: req.files.licenseImage[0].mimetype,
//           size: req.files.licenseImage[0].size
//         },
//         profileImage: null,
//         isVerified: isVerified === 'true' || isVerified === true,
//         isActive: true,
//         rating: 0,
//         totalTrips: 0,
//         earnings: 0
//       };

//       // Add profile image if uploaded
//       if (req.files.profileImage && req.files.profileImage[0]) {
//         driverData.profileImage = {
//           key: req.files.profileImage[0].key,
//           url: getS3Url(req.files.profileImage[0].key),
//           originalName: req.files.profileImage[0].originalname,
//           mimeType: req.files.profileImage[0].mimetype,
//           size: req.files.profileImage[0].size
//         };
//       }

//       console.log('Creating new driver with data:', {
//         driverName: driverData.driverName,
//         phoneNumber: driverData.phoneNumber,
//         licenseNumber: driverData.licenseNumber,
//         hasProfileImage: !!driverData.profileImage,
//         hasLicenseImage: true
//       });

//       // Create new driver
//       const newDriver = new Driver(driverData);
//       const savedDriver = await newDriver.save();

//       console.log('✅ Driver created successfully:', savedDriver._id);

//       // Generate tokens
//       const accessToken = generateAccessToken(savedDriver);
//       const refreshToken = generateRefreshToken(savedDriver);

//       savedDriver.refreshToken = refreshToken;
//       await savedDriver.save();

//       const driverProfile = savedDriver.getPublicProfile();

//       res.status(201).json({
//         success: true,
//         message: 'Driver registered successfully',
//         data: {
//           driver: driverProfile,
//           tokens: {
//             accessToken,
//             refreshToken,
//             tokenType: 'Bearer',
//             expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m'
//           }
//         }
//       });
      
//     } catch (error) {
//       console.error('❌ Register driver error:', error);
      
//       // Delete uploaded files if error occurs
//       if (req.files) {
//         if (req.files.profileImage && req.files.profileImage[0]) {
//           await deleteFromS3(req.files.profileImage[0].key).catch(() => {});
//         }
//         if (req.files.licenseImage && req.files.licenseImage[0]) {
//           await deleteFromS3(req.files.licenseImage[0].key).catch(() => {});
//         }
//       }

//       // Handle duplicate key error
//       if (error.code === 11000) {
//         const field = Object.keys(error.keyPattern)[0];
        
//         // Special handling for license field with null value
//         if (field === 'licenseNumber' && (error.keyValue?.licenseNumber === null || error.keyValue?.licenseNumber === undefined)) {
//           return res.status(400).json({
//             success: false,
//             message: 'Database has invalid driver records with missing license numbers',
//             errorCode: 'NULL_LICENSE_EXISTS',
//             suggestion: 'Please contact administrator to clean up invalid driver records',
//             fix: 'Run GET /api/drivers/debug/fix-null-licenses to automatically fix this issue'
//           });
//         }
        
//         return res.status(400).json({
//           success: false,
//           message: `Driver with this ${field} already exists`,
//           field: field,
//           errorCode: 'DUPLICATE_KEY'
//         });
//       }

//       res.status(500).json({
//         success: false,
//         message: 'Error registering driver',
//         error: error.message
//       });
//     }
//   }
// );


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

module.exports = router;