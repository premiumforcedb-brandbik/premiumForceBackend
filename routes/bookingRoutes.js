// routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const Booking = require('../models/booking_model');


const User = require('../models/users_model');
const City = require('../models/city_model');

const Airport = require('../models/airportsModel');
const Terminal = require('../models/terminal_model');


const Car = require('../models/car_model');

const Driver = require('../models/driver_model');
const Customer = require('../models/users_model');

const authMiddleware = require('../middleware/authTheMiddle');

const { authenticateToken,
  authorizeAdmin,
} = require('../middleware/adminmiddleware');

const { ObjectId } = require('mongoose').Types;


const { authenticateCustomer } = require('../middleware/customermiddleware');
const { upload } = require('../config/s3config');
const { applyDispatcherCityFilter } = require('../utils/spatialUtils');

// Import Validation and Controller
const validate = require('../middleware/validateMiddleware');
const { bookingCreateSchema } = require('../validations/bookingValidation');
const bookingController = require('../controller/bookingController');





// Helper functions moved to controller




// ============= CREATE BOOKING =============
router.post('/',
  authenticateCustomer,
  upload.fields([{ name: 'specialRequestAudio', maxCount: 1 }]),
  validate(bookingCreateSchema),
  bookingController.createBooking
);





// ============= UPDATE BOOKING by ID =============
router.put('/:id',
  authenticateCustomer,
  upload.fields([
    { name: 'specialRequestAudio', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      console.log('Update booking - ID:', req.params.id);
      console.log('Request body:', req.body);
      console.log('Request files:', req.files);

      // Check if req.customer exists
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
        customerID: customerId
      });

      if (!existingBooking) {
        // Delete uploaded files if booking not found
        if (req.files) {
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
        }
        return res.status(404).json({
          success: false,
          message: 'Booking not found or you do not have permission to update it'
        });
      }

      console.log('Current booking status:', existingBooking.bookingStatus);
      console.log('Current driver ID:', existingBooking.driverID);

      // Extract fields from request body
      const {
        category, cityID, airportID, terminalID, flightNumber, 
        arrival, departure, pickupDateTime,
        pickupLat, pickupLong, pickupAddress, dropOffLat, dropOffLong, dropOffAddress,
        carID, charge, specialRequestText,
        passengerCount, passengerNames, passengerMobile, distance,
        bookingStatus, transactionID, orderID, discountPercentage, vat,
        allowSimilarVehicle
      } = req.body;

      // Determine the primary booking time if any provided
      const rawBookingDate = arrival || departure || pickupDateTime;

      // Helper function to check if value is null/undefined/empty
      const isValidValue = (value) => {
        return value !== undefined && value !== null && value !== '' && value !== 'null' && value !== 'undefined';
      };

      // Helper function to safely convert to ObjectId
      const toObjectId = (value, existingValue) => {
        if (!isValidValue(value)) return existingValue;

        // If it's already an ObjectId
        if (value instanceof mongoose.Types.ObjectId) {
          return value;
        }

        // If it's a string, try to convert
        if (typeof value === 'string') {
          const trimmedId = value.trim();
          // Check if it's a valid ObjectId (24 hex characters)
          if (/^[0-9a-fA-F]{24}$/.test(trimmedId)) {
            return new ObjectId(trimmedId);
          }
        }

        console.warn(`Invalid ObjectId format for update:`, value);
        return existingValue;
      };

      // Helper function to clean string fields
      const cleanStringField = (value, existingValue) => {
        if (!isValidValue(value)) return existingValue;
        return String(value).trim();
      };

      const cleanNumberField = (value, existingValue, parseFunc = parseFloat) => {
        if (!isValidValue(value)) return existingValue;
        const parsed = parseFunc(value);
        return isNaN(parsed) ? existingValue : parsed;
      };

      // Validate date if provided
      let parsedDate = existingBooking.pickupDateTime;
      if (isValidValue(rawBookingDate)) {
        try {
          const arrivalStr = String(rawBookingDate).trim();
          parsedDate = new Date(arrivalStr);
          if (isNaN(parsedDate.getTime())) {
            throw new Error('Invalid date');
          }
          console.log('Updated booking date:', parsedDate);
        } catch (dateError) {

          if (req.files) {
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }

          return res.status(400).json({
            success: false,
            message: 'Invalid date format for arrival. Use ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)'
          });

        }
      }


      // Parse passengerNames if provided
      let parsedPassengerNames = existingBooking.passengerNames;
      if (isValidValue(passengerNames)) {
        if (typeof passengerNames === 'string') {
          try {
            parsedPassengerNames = JSON.parse(passengerNames);
            if (!Array.isArray(parsedPassengerNames)) {
              parsedPassengerNames = [passengerNames];
            }
          } catch {
            // If JSON parse fails, split by comma
            parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
          }
        } else if (Array.isArray(passengerNames)) {
          parsedPassengerNames = passengerNames;
        }
      }

      // Prepare update data - Start with an empty object
      const updateData = {};

      // Add all regular fields
      updateData.category = cleanStringField(category, existingBooking.category);
      updateData.vat = cleanNumberField(vat, existingBooking.vat);
      updateData.cityID = toObjectId(cityID, existingBooking.cityID);
      updateData.airportID = toObjectId(airportID, existingBooking.airportID);
      updateData.terminalID = toObjectId(terminalID, existingBooking.terminalID);
      updateData.flightNumber = cleanStringField(flightNumber, existingBooking.flightNumber);
      updateData.pickupDateTime = parsedDate;
      updateData.pickupLat = cleanNumberField(pickupLat, existingBooking.pickupLat, parseFloat);
      updateData.pickupLong = cleanNumberField(pickupLong, existingBooking.pickupLong, parseFloat);
      updateData.pickupAddress = cleanStringField(pickupAddress, existingBooking.pickupAddress);
      updateData.dropOffLat = cleanNumberField(dropOffLat, existingBooking.dropOffLat, parseFloat);
      updateData.dropOffLong = cleanNumberField(dropOffLong, existingBooking.dropOffLong, parseFloat);
      updateData.dropOffAddress = cleanStringField(dropOffAddress, existingBooking.dropOffAddress);
      updateData.carID = toObjectId(carID, existingBooking.carID);
      updateData.charge = cleanStringField(charge, existingBooking.charge);
      updateData.passengerCount = cleanNumberField(passengerCount, existingBooking.passengerCount, parseInt);
      updateData.passengerNames = parsedPassengerNames;
      updateData.passengerMobile = cleanStringField(passengerMobile, existingBooking.passengerMobile);
      updateData.distance = cleanStringField(distance, existingBooking.distance);
      updateData.transactionID = cleanStringField(transactionID, existingBooking.transactionID);
      updateData.orderID = cleanStringField(orderID, existingBooking.orderID);
      updateData.discountPercentage = discountPercentage || 0;
      updateData.allowSimilarVehicle = allowSimilarVehicle !== undefined ? (String(allowSimilarVehicle) === 'true') : existingBooking.allowSimilarVehicle;
      updateData.updatedAt = new Date();

      // Handle booking status update
      if (isValidValue(bookingStatus)) {
        const newStatus = String(bookingStatus).trim().toLowerCase();

        // Define allowed statuses
        const allowedStatuses = ['pending', 'starttracking', 'assigned', 'completed', 'cancelled'];



        // Check if the new status is valid
        if (!allowedStatuses.includes(newStatus)) {
          if (req.files) {
            if (req.files.carimage) await deleteFromS3(req.files.carimage[0].key);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
          }
          return res.status(400).json({
            success: false,
            message: `Invalid booking status. Allowed statuses: ${allowedStatuses.join(', ')}`,
            allowedStatuses: allowedStatuses,
            currentStatus: existingBooking.bookingStatus
          });
        }

        updateData.bookingStatus = newStatus;
      }

      // Handle file updates - Special Request Audio
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

      // Remove undefined fields (optional fields that weren't provided)
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      // Handle TrackingTimeLine separately using $push
      // Initialize tracking timeline updates
      const timelineUpdates = [];

      // Add status change to timeline if status changed
      if (isValidValue(bookingStatus) && updateData.bookingStatus !== existingBooking.bookingStatus) {
        timelineUpdates.push(`status_changed_from_${existingBooking.bookingStatus}_to_${updateData.bookingStatus}_by_customer`);
        console.log(`Status changing from ${existingBooking.bookingStatus} to ${updateData.bookingStatus}`);
      }

      // Add general update to timeline
      timelineUpdates.push('booking_updated_by_customer');

      // Prepare the final update operation
      let finalUpdateOperation = { $set: updateData };

      // Add $push for timeline if there are any timeline updates
      if (timelineUpdates.length > 0) {
        finalUpdateOperation.$push = {
          TrackingTimeLine: { $each: timelineUpdates }
        };
      }

      console.log('Final update operation:', JSON.stringify(finalUpdateOperation, (key, value) => {
        if (value instanceof ObjectId) return value.toString();
        return value;
      }, 2));

      // Update the booking
      const updatedBooking = await Booking.findByIdAndUpdate(
        bookingId,
        finalUpdateOperation,
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
      } else if (updateData.bookingStatus === 'completed') {
        await notifyUser(
          customerId,
          '✅ Booking Completed',
          `Your booking has been marked as completed.`,
          {
            type: 'booking_completed',
            bookingId: updatedBooking._id.toString(),
            status: 'completed'
          }
        );
      } else if (updateData.bookingStatus && updateData.bookingStatus !== existingBooking.bookingStatus) {
        await notifyUser(
          customerId,
          '🔄 Booking Status Updated',
          `Your booking status has been updated to ${updateData.bookingStatus}.`,
          {
            type: 'booking_status_updated',
            bookingId: updatedBooking._id.toString(),
            oldStatus: existingBooking.bookingStatus,
            newStatus: updateData.bookingStatus
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



// ============= GET BOOKING STATUS COUNTS FOR CURRENT MONTH =============
// GET /api/bookings/status-counts - Get counts for completed, pending, start_pickup, cancelled
router.get('/status-counts', async (req, res) => {
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
          bookings: {
            $push: {
              id: "$_id",
              charge: "$charge",
              date: "$createdAt",
              customerId: "$customerID",
              carID: "$carID",
              status: "$bookingStatus"
            }
          }
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
  authenticateToken, authorizeAdmin,
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


// ============= GET BOOKING BY ID =============
// GET /api/bookings/:id - Get a single booking with full details (Admin Only)
router.get('/:id',
  authenticateToken,
  authorizeAdmin, // Only admin/superadmin can access
  async (req, res) => {
    try {
      const { id } = req.params;

      // Get admin info from the authenticated token
      const adminId = req.user?.id;
      const adminRole = req.user?.role;

      console.log('Get booking by ID - Admin info:', {
        adminId,
        adminRole,
        bookingId: id
      });

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Admin can access any booking - no restrictions
      const query = { _id: id };

      // Find booking with all populated fields
      const booking = await Booking.findOne(query)
        .populate({
          path: 'customerID',
          model: 'User',
          select: '_id username email phoneNumber countryCode profileImage role isActive fullPhoneNumber'
        })
        .populate({
          path: 'cityID',
          model: 'City',
          select: '_id cityName cityNameAr image isActive createdAt'
        })
        .populate({
          path: 'airportID',
          model: 'Airport',
          populate: {
            path: 'cityID',
            model: 'City',
            select: '_id cityName cityNameAr'
          },
          select: '_id cityID airportName airportNameAr lat long image isActive createdAt'
        })
        .populate({
          path: 'terminalID',
          model: 'Terminal',
          populate: {
            path: 'airportID',
            model: 'Airport',
            select: '_id airportName airportNameAr'
          },
          select: '_id airportID terminalName terminalNameAr image isActive createdAt'
        })
        .populate({
          path: 'carID',
          model: 'Car',
          populate: [
            {
              path: 'categoryID',
              model: 'Category',
              select: '_id name'
            },
            {
              path: 'brandID',
              model: 'Brand',
              select: '_id brandName'
            }
          ],
          select: '_id categoryID brandID carName model numberOfPassengers carImage minimumChargeDistance createdAt'
        })
        .populate({
          path: 'driverID',
          model: 'Driver',
          select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips isActive isVerified createdAt'
        })
        .lean();

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Format the booking response with full details
      const formattedBooking = {
        _id: booking._id,
        category: booking.category,
        vat: booking.vat,

        // City details
        city: booking.cityID && typeof booking.cityID === 'object' ? {
          _id: booking.cityID._id,
          cityName: booking.cityID.cityName,
          cityNameAr: booking.cityID.cityNameAr,
          image: booking.cityID.image,
          isActive: booking.cityID.isActive,
          createdAt: booking.cityID.createdAt
        } : null,

        // Airport details with city info
        airport: booking.airportID && typeof booking.airportID === 'object' ? {
          _id: booking.airportID._id,
          cityDetails: booking.airportID.cityID && typeof booking.airportID.cityID === 'object' ? {
            _id: booking.airportID.cityID._id,
            cityName: booking.airportID.cityID.cityName,
            cityNameAr: booking.airportID.cityID.cityNameAr,
            isActive: booking.airportID.cityID.isActive
          } : null,
          airportName: booking.airportID.airportName,
          airportNameAr: booking.airportID.airportNameAr,
          lat: booking.airportID.lat,
          long: booking.airportID.long,
          image: booking.airportID.image,
          isActive: booking.airportID.isActive,
          createdAt: booking.airportID.createdAt
        } : null,

        // Terminal details with airport info
        terminal: booking.terminalID && typeof booking.terminalID === 'object' ? {
          _id: booking.terminalID._id,
          airportDetails: booking.terminalID.airportID && typeof booking.terminalID.airportID === 'object' ? {
            _id: booking.terminalID.airportID._id,
            airportName: booking.terminalID.airportID.airportName,
            airportNameAr: booking.terminalID.airportID.airportNameAr,
            isActive: booking.terminalID.airportID.isActive
          } : null,
          terminalName: booking.terminalID.terminalName,
          terminalNameAr: booking.terminalID.terminalNameAr,
          image: booking.terminalID.image,
          isActive: booking.terminalID.isActive,
          createdAt: booking.terminalID.createdAt
        } : null,

        // Car details with category and brand
        car: booking.carID && typeof booking.carID === 'object' ? {
          _id: booking.carID._id,
          categoryDetails: booking.carID.categoryID && typeof booking.carID.categoryID === 'object' ? {
            _id: booking.carID.categoryID._id,
            categoryName: booking.carID.categoryID.name,
            isActive: booking.carID.categoryID.isActive

          } : null,
          brandDetails: booking.carID.brandID && typeof booking.carID.brandID === 'object' ? {
            _id: booking.carID.brandID._id,
            brandName: booking.carID.brandID.brandName,
            isActive: booking.carID.brandID.isActive
          } : null,
          carName: booking.carID.carName,
          model: booking.carID.model,
          numberOfPassengers: booking.carID.numberOfPassengers,
          carImage: booking.carID.carImage,
          minimumChargeDistance: booking.carID.minimumChargeDistance,
          createdAt: booking.carID.createdAt
        } : null,

        // Driver details
        driver: booking.driverID && typeof booking.driverID === 'object' ? {
          _id: booking.driverID._id,
          driverName: booking.driverID.driverName,
          countryCode: booking.driverID.countryCode,
          phoneNumber: booking.driverID.phoneNumber,
          fullPhoneNumber: `${booking.driverID.countryCode}${booking.driverID.phoneNumber}`,
          licenseNumber: booking.driverID.licenseNumber,
          profileImage: booking.driverID.profileImage,
          rating: booking.driverID.rating,
          totalTrips: booking.driverID.totalTrips,
          isActive: booking.driverID.isActive,
          isVerified: booking.driverID.isVerified,
          createdAt: booking.driverID.createdAt
        } : null,

        // Customer details
        customer: booking.customerID && typeof booking.customerID === 'object' ? {
          _id: booking.customerID._id,
          username: booking.customerID.username,
          email: booking.customerID.email,
          phoneNumber: booking.customerID.phoneNumber,
          countryCode: booking.customerID.countryCode,
          fullPhoneNumber: `${booking.customerID.countryCode}${booking.customerID.phoneNumber}`,
          profileImage: booking.customerID.profileImage,
          role: booking.customerID.role,
          isActive: booking.customerID.isActive,
          createdAt: booking.customerID.createdAt
        } : null,

        // Flight details
        flightNumber: booking.flightNumber,
        arrival: booking.arrival,

        // Pickup details
        pickupLat: booking.pickupLat,
        pickupLong: booking.pickupLong,
        pickupAddress: booking.pickupAddress,

        // Dropoff details
        dropOffLat: booking.dropOffLat,
        dropOffLong: booking.dropOffLong,
        dropOffAddress: booking.dropOffAddress,

        // Car details from booking
        charge: booking.charge,
        carimage: booking.carimage,
        discountPercentage: booking.discountPercentage || 0,

        // Passenger details
        passengerCount: booking.passengerCount,
        passengerNames: booking.passengerNames,
        passengerMobile: booking.passengerMobile,
        distance: booking.distance,

        // Status and tracking
        bookingStatus: booking.bookingStatus,
        TrackingTimeLine: booking.TrackingTimeLine || [],
        paymentStatus: booking.paymentStatus,
        rating: booking.rating || {},

        // Special requests
        specialRequestText: booking.specialRequestText,
        specialRequestAudio: booking.specialRequestAudio,

        // Transaction details
        transactionID: booking.transactionID,
        orderID: booking.orderID,

        // Timestamps
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,

        // Admin info (for debugging)
        accessedBy: {
          adminId,
          adminRole,
          accessTime: new Date().toISOString()
        }
      };

      res.status(200).json({
        success: true,
        message: 'Booking fetched successfully',
        data: formattedBooking
      });

    } catch (error) {
      console.error('Get booking by ID error:', error);

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




// Optional: PATCH method for partial updates
router.patch('/:id',
  authMiddleware,
  upload.fields([
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
        'cityID', 'airportID', 'terminalID', 'flightNumber', 'arrival', 'departure', 'pickupDateTime', 'category',
        'pickupLat', 'pickupLong', 'dropOffLat', 'dropOffLong', 'dropOffAddress',
        'carID', 'charge', 'specialRequestText',
        'passengerCount', 'passengerNames', 'passengerMobile', 'distance', 'bookingStatus'
      ];

      // Process each field if provided
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          switch (field) {
            case 'arrival':
            case 'departure':
            case 'pickupDateTime':
              const date = new Date(req.body[field]);
              if (isNaN(date.getTime())) {
                return res.status(400).json({
                  success: false,
                  message: `Invalid date format for ${field}`
                });
              }
              updateData.pickupDateTime = date;
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
router.get('/',
  authenticateToken,
  authorizeAdmin,
  async (req, res) => {
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

      if (customerID && mongoose.Types.ObjectId.isValid(customerID)) {
        query.customerID = new mongoose.Types.ObjectId(customerID);
      }
      if (driverID && mongoose.Types.ObjectId.isValid(driverID)) {
        query.driverID = new mongoose.Types.ObjectId(driverID);
      }
      if (status) query.bookingStatus = status;
      if (fromDate || toDate) {
        query.arrival = {};
        if (fromDate) query.arrival.$gte = new Date(fromDate);
        if (toDate) query.arrival.$lte = new Date(toDate);
      }

      // Apply dispatcher city filter (no-op for superadmins)
      const finalQuery = applyDispatcherCityFilter(req.admin, query);

      // First, get the raw bookings to check what's in the database
      const rawBookings = await Booking.find(finalQuery)
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .lean();

      console.log('Raw bookings sample:', rawBookings[0] ? {
        cityID: rawBookings[0].cityID,
        airportID: rawBookings[0].airportID,
        terminalID: rawBookings[0].terminalID,
        carID: rawBookings[0].carID,
        types: {
          cityID: typeof rawBookings[0].cityID,
          airportID: typeof rawBookings[0].airportID
        }
      } : 'No bookings');

      // Find bookings with full population
      const bookings = await Booking.find(finalQuery)
        .populate({
          path: 'customerID',
          model: 'User',
          select: '_id username email phoneNumber countryCode profileImage role isActive fullPhoneNumber'
        })
        .populate({
          path: 'cityID',
          model: 'City',
          select: '_id cityName cityNameAr image isActive createdAt'
        })
        .populate({
          path: 'airportID',
          model: 'Airport',
          populate: {
            path: 'cityID',
            model: 'City',
            select: '_id cityName cityNameAr'
          },
          select: '_id cityID airportName airportNameAr lat long image isActive createdAt'
        })
        .populate({
          path: 'terminalID',
          model: 'Terminal',
          populate: {
            path: 'airportID',
            model: 'Airport',
            select: '_id airportName airportNameAr terminalName terminalNameAr lat long image isActive createdAt'
          },
          select: '_id airportID terminalName terminalNameAr image isActive createdAt'
        })
        .populate({
          path: 'carID',
          model: 'Car',
          populate: [
            {
              path: 'categoryID',
              model: 'Category',
              select: '_id name'
            },
            {
              path: 'brandID',
              model: 'Brand',
              select: '_id brandName'
            }
          ],
          select: '_id categoryID brandID carName model numberOfPassengers carImage minimumChargeDistance createdAt'
        })
        .populate({
          path: 'driverID',
          model: 'Driver',
          select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips isActive isVerified createdAt'
        })
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .lean();

      const total = await Booking.countDocuments(query);

      // Format each booking with full details
      const formattedBookings = bookings.map(booking => {
        // Debug logging for each booking
        console.log(`Booking ${booking._id} population status:`, {
          hasCity: !!booking.cityID,
          cityType: typeof booking.cityID,
          cityData: booking.cityID,
          hasAirport: !!booking.airportID,
          airportType: typeof booking.airportID,
          hasTerminal: !!booking.terminalID,
          terminalType: typeof booking.terminalID,
          hasCar: !!booking.carID,
          carType: typeof booking.carID
        });

        return {
          _id: booking._id,
          category: booking.category,
          vat: booking.vat,
          // City details - Full data from City model
          city: booking.cityID && typeof booking.cityID === 'object' ? {
            _id: booking.cityID._id,
            cityName: booking.cityID.cityName,
            image: booking.cityID.image,
            cityNameAr: booking.cityID.cityNameAr,
            isActive: booking.cityID.isActive,
            createdAt: booking.cityID.createdAt
          } : null,

          // Airport details with city info
          airport: booking.airportID && typeof booking.airportID === 'object' ? {
            _id: booking.airportID._id,
            cityID: booking.airportID.cityID,
            cityDetails: booking.airportID.cityID && typeof booking.airportID.cityID === 'object' ? {
              _id: booking.airportID.cityID._id,
              cityName: booking.airportID.cityID.cityName,
              cityNameAr: booking.airportID.cityID.cityNameAr,
              isActive: booking.airportID.cityID.isActive,
            } : null,
            airportName: booking.airportID.airportName,
            airportNameAr: booking.airportID.airportNameAr,
            lat: booking.airportID.lat,
            long: booking.airportID.long,
            image: booking.airportID.image,
            isActive: booking.airportID.isActive,
            createdAt: booking.airportID.createdAt
          } : null,

          // Terminal details with airport info
          terminal: booking.terminalID && typeof booking.terminalID === 'object' ? {
            _id: booking.terminalID._id,
            airportID: booking.terminalID.airportID,
            airportDetails: booking.terminalID.airportID && typeof booking.terminalID.airportID === 'object' ? {
              _id: booking.terminalID.airportID._id,
              airportName: booking.terminalID.airportID.airportName,
              isActive: booking.terminalID.airportID.isActive
            } : null,
            terminalName: booking.terminalID.terminalName,
            terminalNameAr: booking.terminalID.terminalNameAr,
            image: booking.terminalID.image,
            isActive: booking.terminalID.isActive,
            createdAt: booking.terminalID.createdAt
          } : null,

          // Car details with category and brand
          car: booking.carID && typeof booking.carID === 'object' ? {
            _id: booking.carID._id,
            // categoryID: booking.carID.categoryID,
            categoryDetails: booking.carID.categoryID && typeof booking.carID.categoryID === 'object' ? {
              _id: booking.carID.categoryID._id,
              categoryName: booking.carID.categoryID.name,
              isActive: booking.carID.categoryID.isActive
            } : null,
            // brandID: booking.carID.brandID,
            brandDetails: booking.carID.brandID && typeof booking.carID.brandID === 'object' ? {
              _id: booking.carID.brandID._id,
              brandName: booking.carID.brandID.brandName,
              isActive: booking.carID.brandID.isActive
            } : null,
            carName: booking.carID.carName,
            model: booking.carID.model,
            numberOfPassengers: booking.carID.numberOfPassengers,
            carImage: booking.carID.carImage,
            minimumChargeDistance: booking.carID.minimumChargeDistance,
            createdAt: booking.carID.createdAt
          } : null,

          // Driver details
          driver: booking.driverID && typeof booking.driverID === 'object' ? {
            _id: booking.driverID._id,
            driverName: booking.driverID.driverName,
            countryCode: booking.driverID.countryCode,
            phoneNumber: booking.driverID.phoneNumber,
            fullPhoneNumber: `${booking.driverID.countryCode}${booking.driverID.phoneNumber}`,
            licenseNumber: booking.driverID.licenseNumber,
            profileImage: booking.driverID.profileImage,
            rating: booking.driverID.rating,
            totalTrips: booking.driverID.totalTrips,
            isActive: booking.driverID.isActive,
            isVerified: booking.driverID.isVerified,
            createdAt: booking.driverID.createdAt
          } : null,

          // Customer details
          customer: booking.customerID && typeof booking.customerID === 'object' ? {
            _id: booking.customerID._id,
            username: booking.customerID.username,
            email: booking.customerID.email,
            phoneNumber: booking.customerID.phoneNumber,
            countryCode: booking.customerID.countryCode,
            fullPhoneNumber: `${booking.customerID.countryCode}${booking.customerID.phoneNumber}`,
            profileImage: booking.customerID.profileImage,
            role: booking.customerID.role,
            isActive: booking.customerID.isActive,
            createdAt: booking.customerID.createdAt
          } : null,

          // Keep original IDs for reference
          originalIds: {
            cityID: booking.cityID?._id || booking.cityID,
            airportID: booking.airportID?._id || booking.airportID,
            terminalID: booking.terminalID?._id || booking.terminalID,
            carID: booking.carID?._id || booking.carID,
            customerID: booking.customerID?._id || booking.customerID,
            driverID: booking.driverID?._id || booking.driverID
          },

          // Flight details
          flightNumber: booking.flightNumber,
          arrival: booking.arrival,

          // Pickup details
          pickupLat: booking.pickupLat,
          pickupLong: booking.pickupLong,
          pickupAddress: booking.pickupAddress,

          // Dropoff details
          dropOffLat: booking.dropOffLat,
          dropOffLong: booking.dropOffLong,
          dropOffAddress: booking.dropOffAddress,

          // Car details from booking
          charge: booking.charge,
          carimage: booking.carimage,

          // Passenger details
          passengerCount: booking.passengerCount,
          passengerNames: booking.passengerNames,
          passengerMobile: booking.passengerMobile,
          distance: booking.distance,

          // Status and tracking
          bookingStatus: booking.bookingStatus,
          TrackingTimeLine: booking.TrackingTimeLine || [],
          paymentStatus: booking.paymentStatus,
          rating: booking.rating || {},

          // Special requests
          specialRequestText: booking.specialRequestText,
          specialRequestAudio: booking.specialRequestAudio,

          // Timestamps
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt
        };
      });

      res.json({
        success: true,
        count: formattedBookings.length,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        data: formattedBookings
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



// GET /api/bookings/customer/:customerId - Get all bookings for a specific customer with full details
router.get('/customer/:customerId', async (req, res) => {
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
    const query = { customerID: new mongoose.Types.ObjectId(customerId) };

    // Add status filter if provided
    if (status) {
      query.bookingStatus = status;
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get all bookings for the customer with full population
    const bookings = await Booking.find(query)
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage role isActive fullPhoneNumber'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image isActive createdAt'
      })
      .populate({
        path: 'airportID',
        model: 'Airport',
        populate: {
          path: 'cityID',
          model: 'City',
          select: '_id cityName cityNameAr isActive'
        },
        select: '_id cityID airportName airportNameAr lat long image isActive createdAt'
      })
      .populate({
        path: 'terminalID',
        model: 'Terminal',
        populate: {
          path: 'airportID',
          model: 'Airport',
          select: '_id airportName airportNameAr isActive'
        },
        select: '_id airportID terminalName terminalNameAr image isActive createdAt'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          {
            path: 'categoryID',
            model: 'Category',
            select: '_id name isActive'
          },
          {
            path: 'brandID',
            model: 'Brand',
            select: '_id brandName isActive'
          }
        ],
        select: '_id categoryID brandID isActive carName model numberOfPassengers carImage minimumChargeDistance createdAt'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips isActive isVerified createdAt'
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const total = await Booking.countDocuments(query);

    // Format each booking with full details (similar to admin endpoint)
    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      category: booking.category,
      // City details
      city: booking.cityID && typeof booking.cityID === 'object' ? {
        _id: booking.cityID._id,
        cityName: booking.cityID.cityName,
        cityNameAr: booking.cityID.cityNameAr,
        image: booking.cityID.image,
        isActive: booking.cityID.isActive
      } : null,

      // Airport details with city info
      airport: booking.airportID && typeof booking.airportID === 'object' ? {
        _id: booking.airportID._id,
        airportName: booking.airportID.airportName,
        airportNameAr: booking.airportID.airportNameAr,
        cityDetails: booking.airportID.cityID && typeof booking.airportID.cityID === 'object' ? {
          _id: booking.airportID.cityID._id,
          cityName: booking.airportID.cityID.cityName,
          cityNameAr: booking.airportID.cityID.cityNameAr,
          isActive: booking.airportID.cityID.isActive
        } : null,
        lat: booking.airportID.lat,
        long: booking.airportID.long,
        image: booking.airportID.image,
        isActive: booking.airportID.isActive,
      } : null,

      // Terminal details with airport info
      terminal: booking.terminalID && typeof booking.terminalID === 'object' ? {
        _id: booking.terminalID._id,
        terminalName: booking.terminalID.terminalName,
        terminalNameAr: booking.terminalID.terminalNameAr,
        airportDetails: booking.terminalID.airportID && typeof booking.terminalID.airportID === 'object' ? {
          _id: booking.terminalID.airportID._id,
          airportName: booking.terminalID.airportID.airportName,
          airportNameAr: booking.terminalID.airportID.airportNameAr,
          isActive: booking.terminalID.airportID.isActive
        } : null,

        isActive: booking.terminalID.airportID.isActive,
        image: booking.terminalID.image
      } : null,

      // Car details with category and brand
      car: booking.carID && typeof booking.carID === 'object' ? {
        _id: booking.carID._id,
        carName: booking.carID.carName,
        model: booking.carID.model,
        numberOfPassengers: booking.carID.numberOfPassengers,
        carImage: booking.carID.carImage,
        categoryDetails: booking.carID.categoryID && typeof booking.carID.categoryID === 'object' ? {
          _id: booking.carID.categoryID._id,
          name: booking.carID.categoryID.name,
          isActive: booking.carID.categoryID.isActive
        } : null,
        brandDetails: booking.carID.brandID && typeof booking.carID.brandID === 'object' ? {
          _id: booking.carID.brandID._id,
          brandName: booking.carID.brandID.brandName,
          isActive: booking.carID.brandID.isActive
        } : null
      } : null,

      // Driver details
      driver: booking.driverID && typeof booking.driverID === 'object' ? {
        _id: booking.driverID._id,
        driverName: booking.driverID.driverName,
        phoneNumber: booking.driverID.phoneNumber,
        countryCode: booking.driverID.countryCode,
        fullPhoneNumber: booking.driverID.countryCode && booking.driverID.phoneNumber
          ? `${booking.driverID.countryCode}${booking.driverID.phoneNumber}`
          : null,
        profileImage: booking.driverID.profileImage,
        rating: booking.driverID.rating,
        totalTrips: booking.driverID.totalTrips
      } : null,

      // Customer details (simplified for customer view)
      customer: {
        _id: booking.customerID?._id,
        username: booking.customerID?.username,
        email: booking.customerID?.email,
        phoneNumber: booking.customerID?.phoneNumber,
        profileImage: booking.customerID?.profileImage
      },

      // Flight details
      flightNumber: booking.flightNumber,
      arrival: booking.arrival,

      // Pickup details
      pickupLat: booking.pickupLat,
      pickupLong: booking.pickupLong,
      pickupAddress: booking.pickupAddress,

      // Dropoff details
      dropOffLat: booking.dropOffLat,
      dropOffLong: booking.dropOffLong,
      dropOffAddress: booking.dropOffAddress,

      // Car details from booking
      charge: booking.charge,
      carimage: booking.carimage,
      discountPercentage: booking.discountPercentage || 0,

      // Passenger details
      passengerCount: booking.passengerCount,
      passengerNames: booking.passengerNames,
      passengerMobile: booking.passengerMobile,
      distance: booking.distance,

      // Status and tracking
      bookingStatus: booking.bookingStatus,
      TrackingTimeLine: booking.TrackingTimeLine || [],
      paymentStatus: booking.paymentStatus,
      rating: booking.rating || {},

      // Special requests
      specialRequestText: booking.specialRequestText,
      specialRequestAudio: booking.specialRequestAudio,

      // Transaction details
      transactionID: booking.transactionID,
      orderID: booking.orderID,

      // Timestamps
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    }));

    res.status(200).json({
      success: true,
      message: 'Bookings fetched successfully',
      count: formattedBookings.length,
      total: total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: formattedBookings
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
router.get('/driver/:driverid', async (req, res) => {
  try {
    const { driverid } = req.params;
    const { status, page = 1, limit = 10, sort = '-createdAt' } = req.query;

    console.log('Driver ID received:', driverid);

    // Validate driver ID
    if (!mongoose.Types.ObjectId.isValid(driverid)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format',
        receivedId: driverid
      });
    }

    // Build query
    const query = { driverID: new mongoose.Types.ObjectId(driverid) };

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
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage role isActive fullPhoneNumber'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image isActive createdAt'
      })
      .populate({
        path: 'airportID',
        model: 'Airport',
        populate: {
          path: 'cityID',
          model: 'City',
          select: '_id cityName cityNameAr'
        },
        select: '_id cityID airportName airportNameAr lat long image isActive createdAt'
      })
      .populate({
        path: 'terminalID',
        model: 'Terminal',
        populate: {
          path: 'airportID',
          model: 'Airport',
          select: '_id airportName airportNameAr'
        },
        select: '_id airportID terminalName terminalNameAr image isActive createdAt'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          {
            path: 'categoryID',
            model: 'Category',
            select: '_id name'
          },
          {
            path: 'brandID',
            model: 'Brand',
            select: '_id brandName'
          }
        ],
        select: '_id categoryID brandID carName model numberOfPassengers carImage minimumChargeDistance createdAt'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips isActive isVerified createdAt'
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const total = await Booking.countDocuments(query);

    console.log(`Found ${bookings.length} bookings for driver ${driverid}`);

    // Format each booking with full details (similar to admin endpoint)
    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      category: booking.category,

      // City details
      city: booking.cityID && typeof booking.cityID === 'object' ? {
        _id: booking.cityID._id,
        cityName: booking.cityID.cityName,
        cityNameAr: booking.cityID.cityNameAr,
        image: booking.cityID.image,
        isActive: booking.cityID.isActive,
        createdAt: booking.cityID.createdAt
      } : null,

      // Airport details with city info
      airport: booking.airportID && typeof booking.airportID === 'object' ? {
        _id: booking.airportID._id,
        airportName: booking.airportID.airportName,
        airportNameAr: booking.airportID.airportNameAr,
        cityDetails: booking.airportID.cityID && typeof booking.airportID.cityID === 'object' ? {
          _id: booking.airportID.cityID._id,
          cityName: booking.airportID.cityID.cityName,
          cityNameAr: booking.airportID.cityID.cityNameAr,
          isActive: booking.airportID.cityID.isActive,
        } : null,
        lat: booking.airportID.lat,
        long: booking.airportID.long,
        image: booking.airportID.image,
        isActive: booking.airportID.isActive,
        createdAt: booking.airportID.createdAt
      } : null,

      // Terminal details with airport info
      terminal: booking.terminalID && typeof booking.terminalID === 'object' ? {
        _id: booking.terminalID._id,
        terminalName: booking.terminalID.terminalName,
        terminalNameAr: booking.terminalID.terminalNameAr,
        airportDetails: booking.terminalID.airportID && typeof booking.terminalID.airportID === 'object' ? {
          _id: booking.terminalID.airportID._id,
          airportName: booking.terminalID.airportID.airportName,
          airportNameAr: booking.terminalID.airportID.airportNameAr,
          isActive: booking.terminalID.airportID.isActive
        } : null,
        image: booking.terminalID.image,
        isActive: booking.terminalID.isActive,
        createdAt: booking.terminalID.createdAt
      } : null,

      // Car details with category and brand
      car: booking.carID && typeof booking.carID === 'object' ? {
        _id: booking.carID._id,
        carName: booking.carID.carName,
        model: booking.carID.model,
        numberOfPassengers: booking.carID.numberOfPassengers,
        carImage: booking.carID.carImage,
        minimumChargeDistance: booking.carID.minimumChargeDistance,
        categoryDetails: booking.carID.categoryID && typeof booking.carID.categoryID === 'object' ? {
          _id: booking.carID.categoryID._id,
          name: booking.carID.categoryID.name,
          isActive: booking.carID.categoryID.isActive
        } : null,
        brandDetails: booking.carID.brandID && typeof booking.carID.brandID === 'object' ? {
          _id: booking.carID.brandID._id,
          brandName: booking.carID.brandID.brandName,
          isActive: booking.carID.brandID.isActive
        } : null,
        createdAt: booking.carID.createdAt
      } : null,

      // Driver details (for driver view - can see their own info)
      driver: booking.driverID && typeof booking.driverID === 'object' ? {
        _id: booking.driverID._id,
        driverName: booking.driverID.driverName,
        countryCode: booking.driverID.countryCode,
        phoneNumber: booking.driverID.phoneNumber,
        fullPhoneNumber: booking.driverID.countryCode && booking.driverID.phoneNumber
          ? `${booking.driverID.countryCode}${booking.driverID.phoneNumber}`
          : null,
        licenseNumber: booking.driverID.licenseNumber,
        profileImage: booking.driverID.profileImage,
        rating: booking.driverID.rating,
        totalTrips: booking.driverID.totalTrips,
        isActive: booking.driverID.isActive,
        isVerified: booking.driverID.isVerified,
        createdAt: booking.driverID.createdAt
      } : null,

      // Customer details
      customer: booking.customerID && typeof booking.customerID === 'object' ? {
        _id: booking.customerID._id,
        username: booking.customerID.username,
        email: booking.customerID.email,
        phoneNumber: booking.customerID.phoneNumber,
        countryCode: booking.customerID.countryCode,
        fullPhoneNumber: booking.customerID.countryCode && booking.customerID.phoneNumber
          ? `${booking.customerID.countryCode}${booking.customerID.phoneNumber}`
          : null,
        profileImage: booking.customerID.profileImage,
        role: booking.customerID.role,
        isActive: booking.customerID.isActive
      } : null,

      // Flight details
      flightNumber: booking.flightNumber,
      arrival: booking.arrival,

      // Pickup details
      pickupLat: booking.pickupLat,
      pickupLong: booking.pickupLong,
      pickupAddress: booking.pickupAddress,

      // Dropoff details
      dropOffLat: booking.dropOffLat,
      dropOffLong: booking.dropOffLong,
      dropOffAddress: booking.dropOffAddress,

      // Car details from booking
      charge: booking.charge,
      carimage: booking.carimage,
      discountPercentage: booking.discountPercentage || 0,

      // Passenger details
      passengerCount: booking.passengerCount,
      passengerNames: booking.passengerNames,
      passengerMobile: booking.passengerMobile,
      distance: booking.distance,

      // Status and tracking
      bookingStatus: booking.bookingStatus,
      TrackingTimeLine: booking.TrackingTimeLine || [],
      paymentStatus: booking.paymentStatus,
      rating: booking.rating || {},

      // Special requests
      specialRequestText: booking.specialRequestText,
      specialRequestAudio: booking.specialRequestAudio,

      // Transaction details
      transactionID: booking.transactionID,
      orderID: booking.orderID,

      // Timestamps
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt
    }));

    res.status(200).json({
      success: true,
      message: formattedBookings.length > 0 ? 'Bookings fetched successfully' : 'No bookings found for this driver',
      count: formattedBookings.length,
      total: total,
      data: formattedBookings,
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
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    const validStatuses = ['pending', 'assigned', 'starttracking', 'completed', 'cancelled', 'reviewed'];

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
  authorizeAdmin, async (req, res) => {
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
  authorizeAdmin, async (req, res) => {
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
