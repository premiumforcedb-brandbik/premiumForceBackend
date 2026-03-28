// routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const Booking = require('../models/booking_model');

const User = require('../models/users_model');
const authMiddleware = require('../middleware/authTheMiddle');

const {   authenticateToken,
  authorizeAdmin,
 } = require('../middleware/adminmiddleware');


 const {authenticateCustomer
 } = require('../middleware/customermiddleware');
 

// Import S3 configuration from your central config file (like in userRoutes)
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');

const NotificationService = require('../services/notificationService');


const { notifyUser, notifyUsers } = require('../fcm');







// ============= GET BOOKING STATUS COUNTS FOR CURRENT MONTH =============
// GET /api/bookings/status-counts - Get counts for completed, pending, start_pickup, cancelled
router.get('/status-counts',async (req, res) => {
  try {
    // Get current date
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11 (January is 0)
    
    // Create start and end dates for current month
    const startOfMonth = new Date(currentYear, currentMonth, 1);
    const endOfMonth = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999);
    
    console.log('Start of month:', startOfMonth);
    console.log('End of month:', endOfMonth);

    // Get counts for all 4 statuses in one query using aggregation
    const results = await Booking.aggregate([
      {
        $match: {
          createdAt: { 
            $gte: startOfMonth, 
            $lte: endOfMonth 
          },
          bookingStatus: { 
            $in: ['completed', 'pending', 'start_pickup', 'cancelled'] 
          }
        }
      },
      {
        $group: {
          _id: '$bookingStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    // Initialize counts object with all statuses set to 0
    const counts = {
      completed: 0,
      pending: 0,
      start_pickup: 0,
      cancelled: 0,
      total: 0
    };

    // Fill in the actual counts
    results.forEach(item => {
      if (counts.hasOwnProperty(item._id)) {
        counts[item._id] = item.count;
        counts.total += item.count;
      }
    });

    // Get month name
    const monthName = now.toLocaleString('default', { month: 'long' });

    res.status(200).json({
      success: true,
      message: 'Booking status counts fetched successfully',
      data: {
        month: monthName,
        year: currentYear,
        dateRange: {
          from: startOfMonth,
          to: endOfMonth
        },
        counts: counts,
        summary: `Total ${counts.total} bookings in ${monthName} ${currentYear}`
      }
    });

  } catch (error) {
    console.error('Get status counts error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking status counts',
      error: error.message
    });
  }
});








// ============= GET MONTHLY EARNINGS =============
// GET /api/bookings/earnings/monthly - Get monthly earnings (Admin/Driver)
router.get('/earnings/monthly', authenticateToken, async (req, res) => {
  try {
    const { year = new Date().getFullYear(), driverId } = req.query;
    const userId = req.user.id; // From auth middleware
    const userRole = req.user.role; // Assuming role is in token

    console.log('Fetching earnings for year:', year);
    console.log('User role:', userRole);
    console.log('User ID:', userId);

    // Build query based on user role
    let matchQuery = {};

    if (userRole === 'driver') {
      // Driver can only see their own earnings
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      // Admin can see specific driver's earnings if driverId provided
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }
    // If admin without driverId, show all drivers' earnings

    // IMPORTANT: Include ALL booking statuses that represent completed/payment-ready trips
    // Don't filter by bookingStatus if you want to see all earnings
    // matchQuery.bookingStatus = { $in: ['completed', 'payment_completed', 'payment_pending', 'end'] };
    
    // Or remove status filter completely to see all bookings with charges
    // The charge field exists regardless of status

    // Create date range for the entire year based on createdAt
    const startDate = new Date(year, 0, 1); // January 1st
    const endDate = new Date(year, 11, 31, 23, 59, 59, 999); // December 31st

    // Use createdAt instead of updatedAt for original booking date
    matchQuery.createdAt = {
      $gte: startDate,
      $lte: endDate
    };

    console.log('Earnings query:', JSON.stringify(matchQuery, null, 2));

    // First, let's get all bookings for debugging
    const allBookings = await Booking.find(matchQuery).select('createdAt charge bookingStatus driverID');
    console.log(`Found ${allBookings.length} bookings for year ${year}`);
    console.log('Sample bookings:', allBookings.slice(0, 3));

    if (allBookings.length === 0) {
      // If no bookings found with createdAt, try with updatedAt as fallback
      console.log('No bookings found with createdAt, trying updatedAt...');
      const fallbackQuery = {
        ...matchQuery,
        updatedAt: matchQuery.createdAt
      };
      delete fallbackQuery.createdAt;
      
      const fallbackBookings = await Booking.find(fallbackQuery).select('updatedAt charge bookingStatus driverID');
      console.log(`Found ${fallbackBookings.length} bookings with updatedAt`);
      
      if (fallbackBookings.length > 0) {
        matchQuery = fallbackQuery;
      }
    }

    // Aggregation pipeline for monthly earnings
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" }
          },
          totalEarnings: { 
            $sum: { 
              $toDouble: {
                $cond: {
                  if: { $isNumber: "$charge" },
                  then: "$charge",
                  else: { $toDouble: "$charge" }
                }
              }
            } 
          },
          totalBookings: { $sum: 1 },
          averageCharge: { 
            $avg: { 
              $toDouble: {
                $cond: {
                  if: { $isNumber: "$charge" },
                  then: "$charge",
                  else: { $toDouble: "$charge" }
                }
              }
            } 
          },
          bookings: { $push: { 
            id: "$_id",
            charge: "$charge",
            date: "$createdAt",
            customerId: "$customerID",
            carID: "$carID",
            status: "$bookingStatus"
          }}
        }
      },
      { $sort: { "_id.month": 1 } }
    ];

    let monthlyData = await Booking.aggregate(pipeline);

    console.log('Monthly aggregated data:', monthlyData);

    // Format response with all months
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Initialize all months with zero values
    const formattedData = months.map((month, index) => {
      const monthNum = index + 1;
      const monthData = monthlyData.find(d => d._id?.month === monthNum);
      
      // Get actual bookings for this month from the database (for detailed view)
      const monthStart = new Date(year, monthNum - 1, 1);
      const monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);
      
      return {
        month: month,
        monthNumber: monthNum,
        year: parseInt(year),
        totalEarnings: monthData?.totalEarnings || 0,
        totalBookings: monthData?.totalBookings || 0,
        averageCharge: monthData?.averageCharge || 0,
        hasData: !!monthData,
        // Include sample bookings if available
        sampleBookings: monthData?.bookings?.slice(0, 5) || []
      };
    });

    // Calculate totals
    const totals = {
      totalEarnings: formattedData.reduce((sum, m) => sum + m.totalEarnings, 0),
      totalBookings: formattedData.reduce((sum, m) => sum + m.totalBookings, 0),
      averageMonthlyEarnings: formattedData.reduce((sum, m) => sum + m.totalEarnings, 0) / 12,
      averageBookingValue: formattedData.reduce((sum, m) => sum + m.totalEarnings, 0) / 
                          (formattedData.reduce((sum, m) => sum + m.totalBookings, 0) || 1)
    };

    res.status(200).json({
      success: true,
      message: 'Monthly earnings fetched successfully',
      data: {
        year: parseInt(year),
        months: formattedData,
        summary: totals,
        currency: 'SAR',
        debug: {
          totalBookingsInDB: allBookings.length,
          queryUsed: matchQuery
        }
      }
    });

  } catch (error) {
    console.error('Monthly earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching monthly earnings',
      error: error.message
    });
  }
});




// ============= GET LAST 6 MONTHS EARNINGS =============
// GET /api/bookings/earnings/last-6-months - Get last 6 months total earnings (Public)
router.get('/earnings/last-6-months',
  authenticateToken,authorizeAdmin,
  async (req, res) => {
  try {
    console.log('Fetching last 6 months earnings (Public Access)');

    // Calculate date range for last 6 months
    const currentDate = new Date();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(currentDate.getMonth() - 5); // -5 to include current month
    sixMonthsAgo.setDate(1); // Start from first day of the month
    sixMonthsAgo.setHours(0, 0, 0, 0);

    // Set end date to end of current month
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);

    console.log('Date range:', {
      start: sixMonthsAgo,
      end: endDate
    });

    // Build query for all bookings in date range (no user filtering)
    const matchQuery = {
      createdAt: {
        $gte: sixMonthsAgo,
        $lte: endDate
      }
    };

    console.log('Earnings query:', JSON.stringify(matchQuery, null, 2));

    // Aggregation pipeline for monthly earnings
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          totalEarnings: { 
            $sum: { 
              $toDouble: {
                $cond: {
                  if: { $isNumber: "$charge" },
                  then: "$charge",
                  else: { $toDouble: "$charge" }
                }
              }
            } 
          },
          totalBookings: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ];

    let monthlyData = await Booking.aggregate(pipeline);

    console.log('Monthly aggregated data:', monthlyData);

    // Generate last 6 months array
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      
      const year = date.getFullYear();
      const month = date.getMonth() + 1; // JavaScript months are 0-indexed
      const monthName = date.toLocaleString('default', { month: 'long' });
      
      // Find data for this month
      const monthData = monthlyData.find(d => 
        d._id?.year === year && d._id?.month === month
      );
      
      months.push({
        month: monthName,
        monthNumber: month,
        year: year,
        totalEarnings: monthData?.totalEarnings || 0,
        totalBookings: monthData?.totalBookings || 0,
        date: `${year}-${month.toString().padStart(2, '0')}` // YYYY-MM format
      });
    }

    // Calculate totals for the period
    const totalEarnings = months.reduce((sum, m) => sum + m.totalEarnings, 0);
    const totalBookings = months.reduce((sum, m) => sum + m.totalBookings, 0);

    res.status(200).json({
      success: true,
      message: 'Last 6 months earnings fetched successfully',
      data: {
        period: 'last-6-months',
        months: months,
        totalEarnings: totalEarnings,
        totalBookings: totalBookings,
        averageMonthlyEarnings: totalEarnings / 6,
        currency: 'SAR'
      }
    });

  } catch (error) {
    console.error('Last 6 months earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching last 6 months earnings',
      error: error.message
    });
  }
});











// ============= GET EARNINGS FOR SPECIFIC MONTH =============
// GET /api/bookings/earnings/month/:month
router.get('/earnings/month/:month', authenticateToken, async (req, res) => {
  try {
    const { month } = req.params;
    const { year = new Date().getFullYear(), driverId } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Validate month
    const monthNum = parseInt(month);
    if (monthNum < 1 || monthNum > 12) {
      return res.status(400).json({
        success: false,
        message: 'Invalid month. Must be between 1-12'
      });
    }

    // Build query
    let matchQuery = {
      bookingStatus: { $in: ['completed', 'payment_completed'] },
      updatedAt: {
        $gte: new Date(year, monthNum - 1, 1),
        $lte: new Date(year, monthNum, 0, 23, 59, 59, 999)
      }
    };

    if (userRole === 'driver') {
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }

    // Get detailed bookings for the month
    const bookings = await Booking.find(matchQuery)
      .populate('customerID', 'username email phoneNumber')
      .populate('driverID', 'driverName phoneNumber vehicleName')
      .sort({ updatedAt: -1 });

    // Calculate statistics
    const stats = {
      totalEarnings: 0,
      totalBookings: bookings.length,
      averageCharge: 0,
      maxCharge: 0,
      minCharge: Infinity
    };

    bookings.forEach(booking => {
      const charge = parseFloat(booking.charge) || 0;
      stats.totalEarnings += charge;
      stats.maxCharge = Math.max(stats.maxCharge, charge);
      stats.minCharge = Math.min(stats.minCharge, charge);
    });

    stats.averageCharge = stats.totalBookings > 0 ? 
      stats.totalEarnings / stats.totalBookings : 0;
    stats.minCharge = stats.minCharge === Infinity ? 0 : stats.minCharge;

    res.status(200).json({
      success: true,
      message: 'Monthly details fetched successfully',
      data: {
        month: monthNum,
        year: parseInt(year),
        monthName: new Date(year, monthNum - 1).toLocaleString('default', { month: 'long' }),
        statistics: stats,
        bookings: bookings
      }
    });

  } catch (error) {
    console.error('Month earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching month earnings',
      error: error.message
    });
  }
});

// ============= GET EARNINGS WITH DATE RANGE =============
// GET /api/bookings/earnings/range?from=2024-01-01&to=2024-12-31
router.get('/earnings/range', authenticateToken, async (req, res) => {
  try {
    const { from, to, driverId } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: 'Please provide from and to dates'
      });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Build query
    let matchQuery = {
      bookingStatus: { $in: ['completed', 'payment_completed'] },
      updatedAt: {
        $gte: fromDate,
        $lte: toDate
      }
    };

    if (userRole === 'driver') {
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }

    // Group by day
    const earnings = await Booking.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            year: { $year: "$updatedAt" },
            month: { $month: "$updatedAt" },
            day: { $dayOfMonth: "$updatedAt" }
          },
          earnings: { $sum: { $toDouble: "$charge" } },
          bookings: { $sum: 1 },
          charges: { $push: "$charge" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } }
    ]);

    // Calculate summary
    const summary = earnings.reduce((acc, day) => ({
      totalEarnings: acc.totalEarnings + day.earnings,
      totalBookings: acc.totalBookings + day.bookings,
      averageDailyEarnings: 0
    }), { totalEarnings: 0, totalBookings: 0 });

    summary.averageDailyEarnings = earnings.length > 0 ? 
      summary.totalEarnings / earnings.length : 0;

    res.status(200).json({
      success: true,
      message: 'Earnings fetched successfully',
      data: {
        from: fromDate,
        to: toDate,
        daily: earnings,
        summary: summary
      }
    });

  } catch (error) {
    console.error('Range earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching earnings by range',
      error: error.message
    });
  }
});


// ============= GET EARNINGS SUMMARY =============
// GET /api/bookings/earnings/summary
router.get('/earnings/summary', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { driverId } = req.query;

    let matchQuery = {
      bookingStatus: { $in: ['completed', 'payment_completed'] }
    };

    if (userRole === 'driver') {
      matchQuery.driverID = new mongoose.Types.ObjectId(userId);
    } else if (userRole === 'admin' && driverId) {
      matchQuery.driverID = new mongoose.Types.ObjectId(driverId);
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Get various summaries
    const [
      totalEarnings,
      thisMonthEarnings,
      lastMonthEarnings,
      dailyAverage,
      bestDay,
      worstDay
    ] = await Promise.all([
      // Total all-time earnings
      Booking.aggregate([
        { $match: matchQuery },
        { $group: { _id: null, total: { $sum: { $toDouble: "$charge" } } } }
      ]),
      
      // This month earnings
      Booking.aggregate([
        { 
          $match: {
            ...matchQuery,
            updatedAt: {
              $gte: new Date(currentYear, currentMonth, 1),
              $lte: new Date(currentYear, currentMonth + 1, 0, 23, 59, 59, 999)
            }
          }
        },
        { $group: { _id: null, total: { $sum: { $toDouble: "$charge" } } } }
      ]),
      
      // Last month earnings
      Booking.aggregate([
        { 
          $match: {
            ...matchQuery,
            updatedAt: {
              $gte: new Date(currentYear, currentMonth - 1, 1),
              $lte: new Date(currentYear, currentMonth, 0, 23, 59, 59, 999)
            }
          }
        },
        { $group: { _id: null, total: { $sum: { $toDouble: "$charge" } } } }
      ]),
      
      // Daily average
      Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              year: { $year: "$updatedAt" },
              month: { $month: "$updatedAt" },
              day: { $dayOfMonth: "$updatedAt" }
            },
            dailyTotal: { $sum: { $toDouble: "$charge" } }
          }
        },
        {
          $group: {
            _id: null,
            average: { $avg: "$dailyTotal" }
          }
        }
      ]),
      
      // Best day (highest earnings)
      Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" } }
            },
            total: { $sum: { $toDouble: "$charge" } }
          }
        },
        { $sort: { total: -1 } },
        { $limit: 1 }
      ]),
      
      // Worst day (lowest earnings)
      Booking.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" } }
            },
            total: { $sum: { $toDouble: "$charge" } }
          }
        },
        { $sort: { total: 1 } },
        { $limit: 1 }
      ])
    ]);

    res.status(200).json({
      success: true,
      message: 'Earnings summary fetched successfully',
      data: {
        totalEarnings: totalEarnings[0]?.total || 0,
        thisMonthEarnings: thisMonthEarnings[0]?.total || 0,
        lastMonthEarnings: lastMonthEarnings[0]?.total || 0,
        dailyAverage: dailyAverage[0]?.average || 0,
        bestDay: bestDay[0] || { date: 'No data', total: 0 },
        worstDay: worstDay[0] || { date: 'No data', total: 0 },
        currency: 'SAR'
      }
    });

  } catch (error) {
    console.error('Earnings summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching earnings summary',
      error: error.message
    });
  }
});





// ============= CREATE BOOKING with Images =============
// POST /api/bookings - Create a new booking with car image and optional audio
router.post('/', 
  authenticateCustomer,
  upload.fields([
    { name: 'carimage', maxCount: 1 },
    { name: 'specialRequestAudio', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);
      
      // FIXED: Check if req.customer exists
      if (!req.customer) {
        return res.status(401).json({
          success: false,
          message: 'Authentication failed - Customer data not found'
        });
      }
      
      console.log('Authenticated customer:', req.customer);

      const {
        category, cityID, airportID, terminalID, flightNumber, arrival,
        pickupLat, pickupLong, pickupAddress, dropOffLat, dropOffLong, dropOffAddress,
        charge, carID, carmodel,
        specialRequestText,
        passengerCount, passengerNames, passengerMobile, distance,
        bookingStatus, driverID
      } = req.body;

      // Get customer ID from authenticated user
      const customerID = req.customer.customerId;

      // Validation for required fields (driverID is NOT required)
      if (!category || !cityID || !arrival || !pickupLat || !pickupLong || 
          !dropOffLat || !dropOffLong || !dropOffAddress ||
          !carmodel || !passengerCount || !passengerNames || 
          !pickupAddress ||
          !passengerMobile || !distance || !charge || !carID) {
        
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carimage) {
            await deleteFromS3(req.files.carimage[0].key);
          }
          if (req.files.specialRequestAudio) {
            await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
        }
        
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields',
          required: ['category', 'cityID', 'arrival', 'pickupLat', 'pickupLong', 
                     'dropOffLat', 'dropOffLong', 'dropOffAddress', 'carmodel', 
                     'passengerCount', 'passengerNames', 'pickupAddress', 
                     'passengerMobile', 'distance', 'charge', 'carID']
        });
      }

      // Validate date
      const parsedDate = new Date(arrival);
      if (isNaN(parsedDate.getTime())) {
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid date format for arrival'
        });
      }

      // CHECK FOR EXISTING BOOKING
      const startOfDay = new Date(parsedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(parsedDate);
      endOfDay.setHours(23, 59, 59, 999);

      const existingBooking = await Booking.findOne({
        customerID: customerID,
        arrival: {
          $gte: startOfDay,
          $lte: endOfDay
        },
        bookingStatus: { $nin: ['cancelled', 'completed'] }
      });

      if (existingBooking) {
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }

        await notifyUser(
          customerID,
          '✅ Booking Already Exists',
          `You already have a booking scheduled for this date`,
          {
            type: 'booking_exists',
            bookingId: existingBooking._id.toString(),
            status: existingBooking.bookingStatus,
          }
        );

        return res.status(400).json({
          success: false,
          message: 'You already have a booking scheduled for this date',
          existingBooking: {
            id: existingBooking._id,
            arrival: existingBooking.arrival,
            status: existingBooking.bookingStatus,
            driverID: existingBooking.driverID
          }
        });
      }

      // Parse passengerNames
      let parsedPassengerNames = [];
      if (typeof passengerNames === 'string') {
        try {
          parsedPassengerNames = JSON.parse(passengerNames);
        } catch {
          parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
        }
      } else if (Array.isArray(passengerNames)) {
        parsedPassengerNames = passengerNames;
      } else {
        parsedPassengerNames = [String(passengerNames)];
      }

      // Handle driverID validation properly
      let finalDriverID = null;
      if (driverID !== undefined && driverID !== null && driverID !== '' && driverID !== 'null' && driverID !== 'undefined') {
        if (mongoose.Types.ObjectId.isValid(driverID)) {
          finalDriverID = driverID;
        }
      }

      // Create booking object
      const bookingData = {
        category: String(category).trim(),
        cityID: String(cityID).trim(),
        airportID: airportID ? String(airportID).trim() : undefined,
        terminalID: terminalID ? String(terminalID).trim() : undefined,
        flightNumber: flightNumber ? String(flightNumber).trim() : undefined,
        arrival: parsedDate,
        pickupLat: parseFloat(pickupLat),
        pickupLong: parseFloat(pickupLong),
        pickupAddress: String(pickupAddress).trim(),
        dropOffLat: parseFloat(dropOffLat),
        dropOffLong: parseFloat(dropOffLong),
        dropOffAddress: String(dropOffAddress).trim(),
        carID: String(carID).trim(),
        carmodel: String(carmodel).trim(),
        charge: String(charge).trim(),
        carimage: req.files && req.files.carimage && req.files.carimage.length > 0 ? {
          key: req.files.carimage[0].key,
          url: getS3Url(req.files.carimage[0].key),
          originalName: req.files.carimage[0].originalname,
          mimeType: req.files.carimage[0].mimetype,
          size: req.files.carimage[0].size
        } : null,
        passengerCount: parseInt(passengerCount),
        passengerNames: parsedPassengerNames,
        passengerMobile: String(passengerMobile).trim(),
        distance: String(distance).trim(),
        customerID: customerID, // Auto-set from authenticated user
        bookingStatus: bookingStatus || 'pending',
        TrackingTimeLine: ['booking_created'],
        paymentStatus: false,
        rating: {},
        driverID: finalDriverID
      };

      // Add optional fields
      if (specialRequestText && specialRequestText.trim() !== '') {
        bookingData.specialRequestText = String(specialRequestText).trim();
      }

      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
        bookingData.specialRequestAudio = {
          key: req.files.specialRequestAudio[0].key,
          url: getS3Url(req.files.specialRequestAudio[0].key),
          originalName: req.files.specialRequestAudio[0].originalname,
          mimeType: req.files.specialRequestAudio[0].mimetype,
          size: req.files.specialRequestAudio[0].size
        };
      }

      console.log('Booking data to save:', bookingData);

      const booking = new Booking(bookingData);
      await booking.save();

      // Send notification to the customer
      await notifyUser(
        customerID,
        '✅ Booking Confirmed',
        `Your booking has been created successfully.`,
        {
          type: 'booking_created',
          bookingId: booking._id.toString(),
          status: booking.bookingStatus,
        }
      );

      res.status(201).json({
        success: true,
        message: 'Booking created successfully',
        data: booking
      });
      
    } catch (error) {
      console.error('Create booking error:', error);
      
      // Delete uploaded files if error occurs
      if (req.files) {
        if (req.files.carimage) {
          await deleteFromS3(req.files.carimage[0].key).catch(console.error);
        }
        if (req.files.specialRequestAudio) {
          await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
      }

      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors
        });
      }

      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Duplicate field value entered'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error creating booking',
        error: error.message
      });
    }
});



// ============= UPDATE BOOKING by ID =============
// PUT /api/bookings/:id - Update booking (customer can only update their own bookings)
router.put('/:id', 
  authenticateCustomer,
  upload.fields([
    { name: 'carimage', maxCount: 1 },
    { name: 'specialRequestAudio', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      console.log('Update booking - ID:', req.params.id);
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);
      
      // FIXED: Check if req.customer exists
      if (!req.customer) {
        return res.status(401).json({
          success: false,
          message: 'Authentication failed - Customer data not found'
        });
      }
      
      console.log('Authenticated customer:', req.customer);

      const bookingId = req.params.id;
      const customerId = req.customer.customerId;

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Check if booking exists AND belongs to the authenticated customer
      const existingBooking = await Booking.findOne({
        _id: bookingId,
        customerID: customerId // Ensure customer owns this booking
      });
      
      if (!existingBooking) {
        // Delete uploaded files if booking not found
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(404).json({
          success: false,
          message: 'Booking not found or you do not have permission to update it'
        });
      }

      // Check if booking can be updated (not completed or cancelled)
      if (existingBooking.bookingStatus === 'completed') {
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Cannot update a completed booking'
        });
      }

      if (existingBooking.bookingStatus === 'cancelled') {
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Cannot update a cancelled booking'
        });
      }

      // Extract fields from request body
      const {
        category, cityID, airportID, terminalID, flightNumber, arrival,
        pickupLat, pickupLong, pickupAddress, dropOffLat, dropOffLong, dropOffAddress,
        carID, charge, carmodel, specialRequestText,
        passengerCount, passengerNames, passengerMobile, distance,
        bookingStatus
      } = req.body;

      // Helper function to check if value is null/undefined/empty
      const isValidValue = (value) => {
        return value !== undefined && value !== null && value !== '' && value !== 'null' && value !== 'undefined';
      };

      // Validate date if provided
      let parsedDate = existingBooking.arrival;
      if (isValidValue(arrival)) {
        parsedDate = new Date(arrival);
        if (isNaN(parsedDate.getTime())) {
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid date format for arrival'
          });
        }
      }

      // Parse passengerNames if provided
      let parsedPassengerNames = existingBooking.passengerNames;
      if (isValidValue(passengerNames)) {
        if (typeof passengerNames === 'string') {
          try {
            parsedPassengerNames = JSON.parse(passengerNames);
          } catch {
            parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
          }
        } else if (Array.isArray(passengerNames)) {
          parsedPassengerNames = passengerNames;
        }
      }

      // Helper functions
      const cleanStringField = (value, existingValue) => {
        if (!isValidValue(value)) return existingValue;
        return String(value).trim();
      };

      const cleanNumberField = (value, existingValue, parseFunc = parseFloat) => {
        if (!isValidValue(value)) return existingValue;
        return parseFunc(value);
      };

      // Prepare update data
      const updateData = {
        category: cleanStringField(category, existingBooking.category),
        cityID: cleanStringField(cityID, existingBooking.cityID),
        airportID: cleanStringField(airportID, existingBooking.airportID),
        terminalID: cleanStringField(terminalID, existingBooking.terminalID),
        flightNumber: cleanStringField(flightNumber, existingBooking.flightNumber),
        arrival: parsedDate,
        pickupLat: cleanNumberField(pickupLat, existingBooking.pickupLat, parseFloat),
        pickupLong: cleanNumberField(pickupLong, existingBooking.pickupLong, parseFloat),
        pickupAddress: cleanStringField(pickupAddress, existingBooking.pickupAddress),
        dropOffLat: cleanNumberField(dropOffLat, existingBooking.dropOffLat, parseFloat),
        dropOffLong: cleanNumberField(dropOffLong, existingBooking.dropOffLong, parseFloat),
        dropOffAddress: cleanStringField(dropOffAddress, existingBooking.dropOffAddress),
        carID: cleanStringField(carID, existingBooking.carID),
        carmodel: cleanStringField(carmodel, existingBooking.carmodel),
        charge: cleanStringField(charge, existingBooking.charge),
        passengerCount: cleanNumberField(passengerCount, existingBooking.passengerCount, parseInt),
        passengerNames: parsedPassengerNames,
        passengerMobile: cleanStringField(passengerMobile, existingBooking.passengerMobile),
        distance: cleanStringField(distance, existingBooking.distance),
        updatedAt: new Date()
      };

      // Handle booking status update with validation
      if (isValidValue(bookingStatus)) {
        const newStatus = String(bookingStatus).trim().toLowerCase();
        const validStatuses = ['pending', 'cancelled'];
        
        // Customer can only update to pending or cancelled
        if (!validStatuses.includes(newStatus)) {
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          return res.status(400).json({
            success: false,
            message: 'Customer can only update booking status to pending or cancelled',
            allowedStatuses: validStatuses
          });
        }
        
        // Prevent updating to pending if already confirmed/assigned
        if (newStatus === 'pending' && existingBooking.bookingStatus !== 'pending') {
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          return res.status(400).json({
            success: false,
            message: 'Cannot change status to pending once booking is processed'
          });
        }
        
        updateData.bookingStatus = newStatus;
      }

      // Handle file updates
      if (req.files && req.files.carimage && req.files.carimage[0]) {
        // Delete old car image from S3 if exists
        if (existingBooking.carimage && existingBooking.carimage.key) {
          await deleteFromS3(existingBooking.carimage.key).catch(console.error);
        }
        
        updateData.carimage = {
          key: req.files.carimage[0].key,
          url: getS3Url(req.files.carimage[0].key),
          originalName: req.files.carimage[0].originalname,
          mimeType: req.files.carimage[0].mimetype,
          size: req.files.carimage[0].size
        };
      }

      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
        // Delete old audio from S3 if exists
        if (existingBooking.specialRequestAudio && existingBooking.specialRequestAudio.key) {
          await deleteFromS3(existingBooking.specialRequestAudio.key).catch(console.error);
        }
        
        updateData.specialRequestAudio = {
          key: req.files.specialRequestAudio[0].key,
          url: getS3Url(req.files.specialRequestAudio[0].key),
          originalName: req.files.specialRequestAudio[0].originalname,
          mimeType: req.files.specialRequestAudio[0].mimetype,
          size: req.files.specialRequestAudio[0].size
        };
      }

      // Handle special request text
      if (specialRequestText !== undefined) {
        if (isValidValue(specialRequestText)) {
          updateData.specialRequestText = String(specialRequestText).trim();
        } else {
          updateData.specialRequestText = null;
        }
      }

      // Add to tracking timeline
      updateData.$push = { TrackingTimeLine: 'booking_updated_by_customer' };

      console.log('Update data:', JSON.stringify(updateData, null, 2));

      // Update the booking
      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        updateData,
        { new: true, runValidators: true }
      );

      // Send notification based on status change
      if (updateData.bookingStatus === 'cancelled') {
        await notifyUser(
          customerId,
          '❌ Booking Cancelled',
          `Your booking has been cancelled successfully.`,
          {
            type: 'booking_cancelled',
            bookingId: updatedBooking._id.toString(),
            status: 'cancelled'
          }
        );
      } else {
        await notifyUser(
          customerId,
          '📝 Booking Updated',
          `Your booking has been updated successfully.`,
          {
            type: 'booking_updated',
            bookingId: updatedBooking._id.toString(),
            status: updatedBooking.bookingStatus
          }
        );
      }

      res.status(200).json({
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking
      });

    } catch (error) {
      console.error('Update booking error:', error);
      
      // Delete newly uploaded files if error occurs
      if (req.files) {
        if (req.files.carimage) {
          await deleteFromS3(req.files.carimage[0].key).catch(console.error);
        }
        if (req.files.specialRequestAudio) {
          await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
      }

      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating booking',
        error: error.message
      });
    }
});








// router.put('/:id', 
//   authMiddleware, 
//   upload.fields([
//     { name: 'carimage', maxCount: 1 },
//     { name: 'specialRequestAudio', maxCount: 1 }
//   ]), 
//   async (req, res) => {
//     try {
//       console.log('Update booking - ID:', req.params.id);
//       console.log('Request body:', req.body);
//       console.log('Request files:', req.files);

//       const bookingId = req.params.id;

//       // Validate booking ID
//       if (!mongoose.Types.ObjectId.isValid(bookingId)) {
//         // Delete uploaded files if validation fails
//         if (req.files) {
//           if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//           if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid booking ID format'
//         });
//       }

//       // Check if booking exists
//       const existingBooking = await Booking.findById(bookingId);
//       if (!existingBooking) {
//         // Delete uploaded files if booking not found
//         if (req.files) {
//           if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//           if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//         }
//         return res.status(404).json({
//           success: false,
//           message: 'Booking not found'
//         });
//       }

//       // Extract fields from request body
//       const {
//         category, city, airport, terminal, flightNumber, arrival,
//         pickupLat, pickupLong, dropOffLat, dropOffLong, dropOffAddress,
//         carName, charge,
//         carclass, carbrand, carmodel, specialRequestText,
//         passengerCount, passengerNames, passengerMobile, distance,
//         bookingStatus, driverID
//       } = req.body;

//       // Validate required fields (optional for update - you might want to make some fields optional)
//       // You can adjust this validation based on which fields are required for update
//       if (!category || !city || !arrival || !pickupLat || !pickupLong || 
//           !dropOffLat || !dropOffLong || !dropOffAddress || !carclass || 
//           !carbrand || !carmodel || !passengerCount || !passengerNames || 
//           !passengerMobile || !distance || !charge || !carName || !driverID) {
        
//         // Delete uploaded files if validation fails
//         if (req.files) {
//           if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//           if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//         }
        
//         return res.status(400).json({
//           success: false,
//           message: 'Please provide all required fields'
//         });
//       }

//       // Validate date if provided
//       let parsedDate = existingBooking.arrival;
//       if (arrival) {
//         parsedDate = new Date(arrival);
//         if (isNaN(parsedDate.getTime())) {
//           if (req.files) {
//             if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
//           }
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid date format for arrival'
//           });
//         }
//       }

//       // Parse passengerNames
//       let parsedPassengerNames = existingBooking.passengerNames;
//       if (passengerNames) {
//         if (typeof passengerNames === 'string') {
//           try {
//             parsedPassengerNames = JSON.parse(passengerNames);
//           } catch {
//             parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
//           }
//         } else if (Array.isArray(passengerNames)) {
//           parsedPassengerNames = passengerNames;
//         } else {
//           parsedPassengerNames = [String(passengerNames)];
//         }
//       }

//       // Prepare update data
//       const updateData = {
//         category: category ? String(category).trim() : existingBooking.category,
//         city: city ? String(city).trim() : existingBooking.city,
//         airport: airport ? String(airport).trim() : existingBooking.airport,
//         terminal: terminal ? String(terminal).trim() : existingBooking.terminal,
//         flightNumber: flightNumber ? String(flightNumber).trim() : existingBooking.flightNumber,
//         arrival: parsedDate,
//         pickupLat: pickupLat ? parseFloat(pickupLat) : existingBooking.pickupLat,
//         pickupLong: pickupLong ? parseFloat(pickupLong) : existingBooking.pickupLong,
//         dropOffLat: dropOffLat ? parseFloat(dropOffLat) : existingBooking.dropOffLat,
//         dropOffLong: dropOffLong ? parseFloat(dropOffLong) : existingBooking.dropOffLong,
//         dropOffAddress: dropOffAddress ? String(dropOffAddress).trim() : existingBooking.dropOffAddress,
//         carName: carName ? String(carName).trim() : existingBooking.carName,
//         carclass: carclass ? String(carclass).trim() : existingBooking.carclass,
//         carbrand: carbrand ? String(carbrand).trim() : existingBooking.carbrand,
//         carmodel: carmodel ? String(carmodel).trim() : existingBooking.carmodel,
//         charge: charge ? String(charge).trim() : existingBooking.charge,
//         passengerCount: passengerCount ? parseInt(passengerCount) : existingBooking.passengerCount,
//         passengerNames: parsedPassengerNames,
//         passengerMobile: passengerMobile ? String(passengerMobile).trim() : existingBooking.passengerMobile,
//         distance: distance ? String(distance).trim() : existingBooking.distance,
//         bookingStatus: bookingStatus || existingBooking.bookingStatus,
//         driverID: driverID || existingBooking.driverID,
//         updatedAt: new Date() // Add timestamp for tracking
//       };

//       // Handle file updates
      
//       // 1. Handle car image update
//       if (req.files && req.files.carimage && req.files.carimage[0]) {
//         // Delete old car image from S3 if exists
//         if (existingBooking.carimage && existingBooking.carimage.key) {
//           await deleteFromS3(existingBooking.carimage.key).catch(console.error);
//         }
        
//         // Add new car image
//         updateData.carimage = {
//           key: req.files.carimage[0].key,
//           url: getS3Url(req.files.carimage[0].key),
//           originalName: req.files.carimage[0].originalname,
//           mimeType: req.files.carimage[0].mimetype,
//           size: req.files.carimage[0].size
//         };
//       }

//       // 2. Handle special request audio update
//       if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
//         // Delete old audio from S3 if exists
//         if (existingBooking.specialRequestAudio && existingBooking.specialRequestAudio.key) {
//           await deleteFromS3(existingBooking.specialRequestAudio.key).catch(console.error);
//         }
        
//         // Add new audio
//         updateData.specialRequestAudio = {
//           key: req.files.specialRequestAudio[0].key,
//           url: getS3Url(req.files.specialRequestAudio[0].key),
//           originalName: req.files.specialRequestAudio[0].originalname,
//           mimeType: req.files.specialRequestAudio[0].mimetype,
//           size: req.files.specialRequestAudio[0].size
//         };
//       }

//       // 3. Handle special request text update
//       if (specialRequestText !== undefined) {
//         if (specialRequestText && specialRequestText.trim() !== '') {
//           updateData.specialRequestText = String(specialRequestText).trim();
//         } else {
//           // If empty string is sent, remove the field
//           updateData.$unset = { specialRequestText: 1 };
//         }
//       }

//       // Add to tracking timeline
//       updateData.$push = { TrackingTimeLine: 'booking_updated' };

//       console.log('Update data:', updateData);

//       // Update the booking
//       const updatedBooking = await Booking.findByIdAndUpdate(
//         bookingId,
//         updateData,
//         { new: true, runValidators: true } // Return updated document and run validators
//       );

//       if (updatedBooking.bookingStatus === 'assigned') {
//          await notifyUser(
//         customerID,
//         '✅ Booking trip Assisgned',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking Assigned',
//           // bookingId: booking._id.toString(),
//           status: 'confirmed',
//           carName: carName
//         }
//       );
//     }
//     if (updatedBooking.bookingStatus === 'start_pickup') {
//          await notifyUser(
//         customerID,
//         '✅ Trip Pickup Started',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking Pickup Started',
//           // bookingId: booking._id.toString(),
//           status: 'Pickup Started',
//           carName: carName
//         }
//       );
//     }

//        if (updatedBooking.bookingStatus === 'ongoing') {
//          await notifyUser(
//         customerID,
//         '✅ Trip On the way to trip',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking On the way to trip',
//           // bookingId: booking._id.toString(),
//           status: 'On the way to trip',
//           carName: carName
//         }
//       );
//     }

//       if (updatedBooking.bookingStatus === 'end') {
//          await notifyUser(
//         customerID,
//         '✅ Trip Destination Reached',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'booking Destination Reached',
//           // bookingId: booking._id.toString(),
//           status: 'Destination Reached',
//           carName: carName
//         }
//       );
//     }
//        if (updatedBooking.bookingStatus === 'payment_pending') {

//          await notifyUser(
//         customerID,
//         '✅ Driver is awaiting Payment',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'Diver is awaiting Payment',
//           // bookingId: booking._id.toString(),
//           status: 'Diver is Waiting for Payment',
//           carName: carName
//         }
//       );
//     }


//     if (updatedBooking.bookingStatus === 'payment_completed') {

//          await notifyUser(
//         customerID,
//         '✅Trip  Completed',
//         `Your booking for ${carName} has been created successfully.`,
//         {
//           type: 'Trip Completed',
//           // bookingId: booking._id.toString(),
//           status: 'Completed Trip',
//           carName: carName
//         }
//       );
//     }


//       res.status(200).json({
//         success: true,
//         message: 'Booking updated successfully',
//         data: updatedBooking
//       });

//     } catch (error) {
//       console.error('Update booking error:', error);
      
//       // Delete newly uploaded files if error occurs
//       if (req.files) {
//         if (req.files.carimage) {
//           await deleteFromS3(req.files.carimage[0].key).catch(console.error);
//         }
//         if (req.files.specialRequestAudio) {
//           await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//         }
//       }

//       if (error.name === 'ValidationError') {
//         const errors = {};
//         for (let field in error.errors) {
//           errors[field] = error.errors[field].message;
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Validation error',
//           errors: errors
//         });
//       }

//       if (error.code === 11000) {
//         return res.status(400).json({
//           success: false,
//           message: 'Duplicate field value entered'
//         });
//       }

//       res.status(500).json({
//         success: false,
//         message: 'Error updating booking',
//         error: error.message
//       });
//     }
// });










// Optional: PATCH method for partial updates
router.patch('/:id', 
  authMiddleware, 
  upload.fields([
    { name: 'carimage', maxCount: 1 },
    { name: 'specialRequestAudio', maxCount: 1 }
  ]), 
  async (req, res) => {
    try {
      console.log('Partial update booking - ID:', req.params.id);
      // Similar to PUT but without required field validation
      // You can implement a more flexible version here
      
      const bookingId = req.params.id;

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Check if booking exists
      const existingBooking = await Booking.findById(bookingId);
      if (!existingBooking) {
        // Delete uploaded files if booking not found
        if (req.files) {
          if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Build update object dynamically based on provided fields
      const updateData = {};
      const allowedFields = [
        'category', 'cityID', 'airportID', 'terminalID', 'flightNumber', 'arrival',
        'pickupLat', 'pickupLong', 'dropOffLat', 'dropOffLong', 'dropOffAddress',
        'carID', 'charge', 'carmodel', 'specialRequestText',
        'passengerCount', 'passengerNames', 'passengerMobile', 'distance', 'bookingStatus'
      ];

      // Process each field if provided
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          switch (field) {
            case 'arrival':
              const date = new Date(req.body[field]);
              if (isNaN(date.getTime())) {
                return res.status(400).json({
                  success: false,
                  message: 'Invalid date format for arrival'
                });
              }
              updateData[field] = date;
              break;
              
            case 'pickupLat':
            case 'pickupLong':
            case 'dropOffLat':
            case 'dropOffLong':
              updateData[field] = parseFloat(req.body[field]);
              break;
              
            case 'passengerCount':
              updateData[field] = parseInt(req.body[field]);
              break;
              
            case 'passengerNames':
              if (typeof req.body[field] === 'string') {
                try {
                  updateData[field] = JSON.parse(req.body[field]);
                } catch {
                  updateData[field] = req.body[field].split(',').map(name => name.trim());
                }
              } else if (Array.isArray(req.body[field])) {
                updateData[field] = req.body[field];
              } else {
                updateData[field] = [String(req.body[field])];
              }
              break;
              
            case 'specialRequestText':
              if (req.body[field] && req.body[field].trim() !== '') {
                updateData[field] = String(req.body[field]).trim();
              } else {
                updateData.$unset = { ...updateData.$unset, [field]: 1 };
              }
              break;
              
            default:
              updateData[field] = String(req.body[field]).trim();
          }
        }
      }

      // Handle file updates (same as PUT method)
      if (req.files && req.files.carimage && req.files.carimage[0]) {
        if (existingBooking.carimage && existingBooking.carimage.key) {
          await deleteFromS3(existingBooking.carimage.key).catch(console.error);
        }
        updateData.carimage = {
          key: req.files.carimage[0].key,
          url: getS3Url(req.files.carimage[0].key),
          originalName: req.files.carimage[0].originalname,
          mimeType: req.files.carimage[0].mimetype,
          size: req.files.carimage[0].size
        };
      }

      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
        if (existingBooking.specialRequestAudio && existingBooking.specialRequestAudio.key) {
          await deleteFromS3(existingBooking.specialRequestAudio.key).catch(console.error);
        }
        updateData.specialRequestAudio = {
          key: req.files.specialRequestAudio[0].key,
          url: getS3Url(req.files.specialRequestAudio[0].key),
          originalName: req.files.specialRequestAudio[0].originalname,
          mimeType: req.files.specialRequestAudio[0].mimetype,
          size: req.files.specialRequestAudio[0].size
        };
      }

      // Add update timestamp and tracking
      updateData.updatedAt = new Date();
      updateData.$push = { TrackingTimeLine: 'booking_updated' };

      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        updateData,
        { new: true, runValidators: true }
      );

      res.status(200).json({
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking
      });

    } catch (error) {
      console.error('Partial update error:', error);
      // Error handling similar to PUT method
      res.status(500).json({
        success: false,
        message: 'Error updating booking',
        error: error.message
      });
    }
});



// ============= UPDATE BOOKING CHARGE =============
// PATCH /api/bookings/:id/charge - Update only the charge amount
router.patch('/:id/charge', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { charge } = req.body;
    // Validate charge field
    if (!charge) {
      return res.status(400).json({
        success: false,
        message: 'Charge amount is required'
      });
    }

    // Validate charge format (you can adjust this based on your requirements)
    if (typeof charge !== 'string' && typeof charge !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Charge must be a string or number'
      });
    }

    // Convert to string if it's a number
    const chargeValue = typeof charge === 'number' ? charge.toString() : charge;

    // Validate booking ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }

    // Check if booking exists
    const existingBooking = await Booking.findById(id);
    if (!existingBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Update only the charge field
    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { 
        charge: chargeValue,
        updatedAt: new Date(),
        $push: { TrackingTimeLine: 'charge_updated' }
      },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: 'Charge updated successfully',
      data: {
        bookingId: updatedBooking._id,
        charge: updatedBooking.charge,
        previousCharge: existingBooking.charge,
        updatedAt: updatedBooking.updatedAt
      }
    });

  } catch (error) {
    console.error('Update charge error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = {};
      for (let field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors
      });
    }

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating charge',
      error: error.message
    });
  }
});

// Alternative: More flexible charge update with additional options
router.patch('/:id/charge-detailed', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { charge, chargeBreakdown, discount, tax, totalCharge } = req.body;

    // Validate booking ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }

    // Check if booking exists
    const existingBooking = await Booking.findById(id);
    if (!existingBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Build update object with charge-related fields
    const updateData = {
      updatedAt: new Date(),
      $push: { TrackingTimeLine: 'charge_details_updated' }
    };

    // Update main charge if provided
    if (charge !== undefined) {
      const chargeValue = typeof charge === 'number' ? charge.toString() : charge;
      if (!chargeValue) {
        return res.status(400).json({
          success: false,
          message: 'Charge cannot be empty'
        });
      }
      updateData.charge = chargeValue;
    }

    // Update charge breakdown if provided (if your schema supports it)
    if (chargeBreakdown !== undefined) {
      updateData.chargeBreakdown = chargeBreakdown;
    }

    // Update discount if provided (if your schema supports it)
    if (discount !== undefined) {
      updateData.discount = discount;
    }

    // Update tax if provided (if your schema supports it)
    if (tax !== undefined) {
      updateData.tax = tax;
    }

    // Update total charge if provided (if your schema supports it)
    if (totalCharge !== undefined) {
      const totalValue = typeof totalCharge === 'number' ? totalCharge.toString() : totalCharge;
      updateData.totalCharge = totalValue;
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    // Prepare response data
    const responseData = {
      bookingId: updatedBooking._id,
      charge: updatedBooking.charge,
      updatedAt: updatedBooking.updatedAt
    };

    // Include additional fields in response if they exist in the updated booking
    if (updatedBooking.chargeBreakdown) responseData.chargeBreakdown = updatedBooking.chargeBreakdown;
    if (updatedBooking.discount) responseData.discount = updatedBooking.discount;
    if (updatedBooking.tax) responseData.tax = updatedBooking.tax;
    if (updatedBooking.totalCharge) responseData.totalCharge = updatedBooking.totalCharge;

    res.status(200).json({
      success: true,
      message: 'Charge details updated successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Update charge details error:', error);
    
    if (error.name === 'ValidationError') {
      const errors = {};
      for (let field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors
      });
    }

    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating charge details',
      error: error.message
    });
  }
});


// ============= GET ALL BOOKINGS =============
// GET /api/bookings - Get all bookings with filtering
router.get('/', authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const { 
      customerID, 
      driverID, 
      status, 
      fromDate, 
      toDate,
      page = 1,
      limit = 10
    } = req.query;

    const query = {};

    if (customerID) query.customerID = customerID;
    if (driverID) query.driverID = driverID;
    if (status) query.bookingStatus = status;
    // if(paymentStatus) query.paymentStatus = paymentStatus;
    // if(charge) query.charge = charge;
    if (fromDate || toDate) {
      query.arrival = {};
      if (fromDate) query.arrival.$gte = new Date(fromDate);
      if (toDate) query.arrival.$lte = new Date(toDate);
    }

    const bookings = await Booking.find(query)
      .populate('customerID', 'username email phoneNumber profileImage')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.json({
      success: true,
      count: bookings.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: bookings
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings',
      error: error.message
    });
  }
});

// ============= GET BOOKING BY ID =============
// GET /api/bookings/:id - Get single booking
router.get('/:id',  authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('customerID', 'username email phoneNumber profileImage');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching booking',
      error: error.message
    });
  }
});


// GET /api/bookings/customer/:customerId - Get all bookings for a specific customer

router.get('/customer/:customerId', 
    async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, page = 1, limit = 10, sort = '-createdAt' } = req.query;

    // Validate customer ID
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format'
      });
    }

    // Build query
    const query = { customerID: customerId };
    
    // Add status filter if provided
    if (status) {
      query.bookingStatus = status;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get all bookings for the customer with full details
    const bookings = await Booking.find(query)
      .populate('customerID', 'username email phoneNumber profileImage')
      .populate('driverID', 'driverName phoneNumber vehicleName vehicleImage rating')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Booking.countDocuments(query);

    res.status(200).json({
      success: true,
      message: 'Bookings fetched successfully',
      count: bookings.length,
      total: total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: bookings
    });

  } catch (error) {
    console.error('Get customer bookings error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error fetching customer bookings',
      error: error.message
    });
  }
});


// GET BOOKINGS BY DRIVER ID
router.get('/driver/:driverid',async (req, res) => {
  try {
    // FIXED: Use the correct parameter name from the route
    const { driverid } = req.params;  // Changed from driverID to driverid
    const { status, page = 1, limit = 10, sort = '-createdAt' } = req.query;

    console.log('Driver ID received:', driverid);
    
    // Validate driver ID

    if (!mongoose.Types.ObjectId.isValid(driverid)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format',
        receivedId: driverid  // Helpful for debugging
      });
    }

    // Build query - FIXED: Use driverid in query
    const query = { driverID: driverid };  // The field in your schema might be driverId or driverID
    
    // Add status filter if provided
    if (status) {
      query.bookingStatus = status;
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    console.log('Query:', query);

    // Get bookings for the driver with full details
    const bookings = await Booking.find(query)
      .populate('customerID', 'username email phoneNumber profileImage')
      .populate('driverID', 'driverName phoneNumber vehicleName vehicleImage rating')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count for pagination
    const total = await Booking.countDocuments(query);

    console.log(`Found ${bookings.length} bookings for driver ${driverid}`);

    res.status(200).json({
      success: true,
      message: bookings.length > 0 ? 'Bookings fetched successfully' : 'No bookings found for this driver',
      data: bookings,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1
      }
    });

  } catch (error) {
    console.error('Get driver bookings error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error fetching driver bookings',
      error: error.message
    });
  }
});


// ============= UPDATE BOOKING STATUS =============
// PATCH /api/bookings/:id/status - Update booking status
router.patch('/:id/status', authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const { status, driverID } = req.body;
    const { id } = req.params;

    const validStatuses = ['pending', 'confirmed', 'assigned', 'in_progress', 'completed', 'cancelled'];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required'
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const updateData = {
      bookingStatus: status,
      $push: { TrackingTimeLine: `booking_${status}` }
    };

    if (driverID && status === 'assigned') {
      if (!mongoose.Types.ObjectId.isValid(driverID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid driver ID format'
        });
      }
      updateData.driverID = driverID;
    }

    if (status === 'completed') {
      updateData.paymentStatus = true;
      updateData.paymentCompletedAt = new Date();
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: `Booking status updated to ${status}`,
      data: updatedBooking
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating booking status',
      error: error.message
    });
  }
});

// ============= ADD RATING TO BOOKING =============
// PATCH /api/bookings/:id/rating - Add rating
router.patch('/:id/rating',
    authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ratingData = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      { rating: ratingData },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Rating added successfully',
      data: updatedBooking
    });
  } catch (error) {
    console.error('Add rating error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error adding rating',
      error: error.message
    });
  }
});

// ============= UPDATE PAYMENT STATUS =============
// PATCH /api/bookings/:id/payment - Update payment status
router.patch('/:id/payment', authenticateToken,
  authorizeAdmin,async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    if (typeof paymentStatus !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Payment status must be boolean'
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const updateData = {
      paymentStatus,
      paymentCompletedAt: paymentStatus ? new Date() : null
    };

    const updatedBooking = await Booking.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    res.json({
      success: true,
      message: `Payment status updated to ${paymentStatus}`,
      data: updatedBooking
    });
  } catch (error) {
    console.error('Update payment error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating payment status',
      error: error.message
    });
  }
});

// ============= UPDATE CAR IMAGE =============
// PATCH /api/bookings/:id/car-image - Update only car image
router.patch('/:id/car-image', 
  authenticateToken,
  authorizeAdmin,
  upload.single('carimage'), 
  async (req, res) => {
    try {
      
      // if (!req.file) {
      //   return res.status(400).json({
      //     success: false,
      //     message: 'Car image is required'
      //   });
      // }

      const booking = await Booking.findById(req.params.id);
      if (!booking) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Delete old car image
      if (booking.carimage?.key) {
        await deleteFromS3(booking.carimage.key).catch(err => 
          console.error('Error deleting old car image:', err)
        );
      }

      // Update with new car image
      booking.carimage = {
        key: req.file.key,
        url: getS3Url(req.file.key),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      };

      await booking.save();

      res.json({
        success: true,
        message: 'Car image updated successfully',
        data: {
          carimage: booking.carimage
        }
      });
    } catch (error) {
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }
      console.error('Update car image error:', error);
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }
      res.status(500).json({
        success: false,
        message: 'Error updating car image',
        error: error.message
      });
    }
});

// ============= DELETE BOOKING =============
// DELETE /api/bookings/:id - Delete booking and associated files
router.delete('/:id', authenticateToken,
  authorizeAdmin,async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Delete associated files from S3
    if (booking.carimage?.key) {
      await deleteFromS3(booking.carimage.key);
    }
    if (booking.specialRequestAudio?.key) {
      await deleteFromS3(booking.specialRequestAudio.key);
    }

    await Booking.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Booking deleted successfully'
    });
  } catch (error) {
    console.error('Delete booking error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error deleting booking',
      error: error.message
    });
  }
});

// ============= GET BOOKING CAR IMAGE =============
// GET /api/bookings/:id/car-image - Get car image URL
router.get('/:id/car-image', authenticateToken,
  authorizeAdmin, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).select('carimage');
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!booking.carimage) {
      return res.status(404).json({
        success: false,
        message: 'Car image not found'
      });
    }

    res.json({
      success: true,
      data: booking.carimage
    });
  } catch (error) {
    console.error('Fetch car image error:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching car image',
      error: error.message
    });
  }
});


module.exports = router;
