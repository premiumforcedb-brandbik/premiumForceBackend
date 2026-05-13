const Booking = require('../models/booking_model');
const HourlyBooking = require('../models/hourlyBookingModel');
const Airport = require('../models/airportsModel');
const Terminal = require('../models/terminal_model');
const mongoose = require('mongoose');
const { getS3Url, deleteFromS3 } = require('../config/s3config');
const { notificationQueue } = require('../queues/notificationQueue');
const { BookingCategory } = require('../utils/constants');
const { applyDispatcherCityFilter } = require('../utils/spatialUtils');



// ============= CREATE BOOKING =============
createBooking = async (req, res) => {
  try {
    const customerID = req.customer.customerId;
    const { category, terminalID } = req.body;
    const bookingData = { ...req.body, customerID };

    // Handle Airport Locations & Relationship Validation
    if (category === BookingCategory.AIRPORT_ARRIVAL || category === BookingCategory.AIRPORT_DEPARTURE) {
      // Fetch Terminal and populate its Airport (and the Airport's City)
      const terminal = await Terminal.findById(terminalID).populate({
        path: 'airportID',
        model: 'Airport'
      });

      if (!terminal) {
        return res.status(404).json({ success: false, message: 'Terminal not found' });
      }

      const airport = terminal.airportID;
      if (!airport) {
        return res.status(404).json({ success: false, message: 'Airport for this terminal not found' });
      }

      // Automatically override/assign IDs to ensure perfect data integrity
      bookingData.airportID = airport._id;
      bookingData.cityID = airport.cityID;
      bookingData.terminalID = terminal._id;

      // Ensure airport has coordinates
      if (!airport.lat || !airport.long) {
        return res.status(400).json({
          success: false,
          message: `Coordinates missing for airport: ${airport.airportName}`
        });
      }

      // Set Location Data from Airport
      if (category === BookingCategory.AIRPORT_ARRIVAL) {
        bookingData.pickupLat = airport.lat;
        bookingData.pickupLong = airport.long;
        bookingData.pickupAddress = airport.airportName + " " + terminal.terminalName;
      } else {
        bookingData.dropOffLat = airport.lat;
        bookingData.dropOffLong = airport.long;
        bookingData.dropOffAddress = airport.airportName + " " + terminal.terminalName;
      }
    }

    if (!bookingData.pickupLat || !bookingData.pickupLong || !bookingData.pickupAddress) {
      return res.status(400).json({ success: false, message: 'Pickup location (lat, long, address) is required' });
    }
    if (!bookingData.dropOffLat || !bookingData.dropOffLong || !bookingData.dropOffAddress) {
      return res.status(400).json({ success: false, message: 'Drop-off location (lat, long, address) is required' });
    }

    // Initialize Booking State
    bookingData.bookingStatus = 'pending';
    bookingData.TrackingTimeLine = ['booking_created'];
    bookingData.paymentStatus = false;

    // Process Date
    const now = new Date();
    bookingData.pickupDateTime = new Date(req.body.pickupDateTime);

    if (isNaN(bookingData.pickupDateTime.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    // Check if date is in the past (allowing 5 min grace period for network latency)
    if (bookingData.pickupDateTime < new Date(now.getTime() - 5 * 60 * 1000)) {
      return res.status(400).json({ success: false, message: 'Pickup date and time cannot be in the past' });
    }

    // Process Passenger Names
    if (typeof req.body.passengerNames === 'string') {
      try {
        bookingData.passengerNames = JSON.parse(req.body.passengerNames);
      } catch {
        bookingData.passengerNames = req.body.passengerNames.split(',').map(name => name.trim());
      }
    }

    // Handle Audio File
    if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
      const audioFile = req.files.specialRequestAudio[0];
      bookingData.specialRequestAudio = {
        key: audioFile.key,
        url: getS3Url(audioFile.key),
        originalName: audioFile.originalname,
        mimeType: audioFile.mimetype,
        size: audioFile.size,
        format: audioFile.originalname.split('.').pop().toLowerCase()
      };
    }

    const booking = new Booking(bookingData);
    await booking.save();

    // Add notifications to the background queue
    notificationQueue.add('customer_booking_confirmed', {
      type: 'user',
      recipientId: customerID,
      title: '✅ Booking Confirmed',
      body: `Your booking has been created successfully.`,
      data: { type: 'booking_created', bookingId: booking._id.toString() }
    }).catch(err => console.error('Error adding customer notification to queue:', err));

    notificationQueue.add('admin_new_booking', {
      type: 'admin_broadcast',
      title: 'New Booking Alert!',
      body: `Review and assign a driver for booking #${booking._id.toString().slice(-6)}`,
      data: { type: 'new_booking', bookingId: booking._id.toString() }
    }).catch(err => console.error('Error adding admin notification to queue:', err));

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: booking
    });

  } catch (error) {
    console.error('Create booking controller error:', error);

    // Cleanup S3 if error occurs
    if (req.files && req.files.specialRequestAudio) {
      await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
    }

    res.status(500).json({
      success: false,
      message: 'Error creating booking',
      error: error.message
    });
  }
}
// ============= GET ALL BOOKINGS (Admin) =============
const getAllBookings = async (req, res) => {
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
      query.pickupDateTime = {};
      if (fromDate) query.pickupDateTime.$gte = new Date(fromDate);
      if (toDate) query.pickupDateTime.$lte = new Date(toDate);
    }

    // Apply dispatcher city filter (no-op for superadmins)
    const finalQuery = applyDispatcherCityFilter(req.admin, query);

    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const skipNum = (pageNum - 1) * limitNum;

    const total = await Booking.countDocuments(finalQuery);

    const bookings = await Booking.find(finalQuery)
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage fullPhoneNumber'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image'
      })
      .populate({
        path: 'airportID',
        model: 'Airport',
        select: '_id airportName airportNameAr lat long image'
      })
      .populate({
        path: 'terminalID',
        model: 'Terminal',
        select: '_id terminalName terminalNameAr image'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          { path: 'categoryID', model: 'Category', select: '_id name' },
          { path: 'brandID', model: 'Brand', select: '_id brandName' }
        ],
        select: '_id categoryID brandID carName model numberOfPassengers carImage'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips'
      }).populate({
        path: 'fleetID',
        model: 'Fleet',
        populate: [
          {
            path: 'carID',
            model: 'Car',
            select: '_id carName model'
          }
        ],
        select: '_id carLicenseNumber'

      })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skipNum)
      .lean();

    // Simple formatter to flatten populated data for the frontend
    const formattedBookings = bookings.map(booking => ({
      ...booking,
    }));

    res.json({
      success: true,
      count: formattedBookings.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
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
}

// ============= GET BOOKING BY ID (Admin) =============
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;


    const booking = await Booking.findById(id)
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage fullPhoneNumber'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image'
      })
      .populate({
        path: 'airportID',
        model: 'Airport',
        select: '_id airportName airportNameAr lat long image'
      })
      .populate({
        path: 'terminalID',
        model: 'Terminal',
        select: '_id terminalName terminalNameAr image'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          { path: 'categoryID', model: 'Category', select: '_id name' },
          { path: 'brandID', model: 'Brand', select: '_id brandName' }
        ],
        select: '_id categoryID brandID carName model numberOfPassengers carImage'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips'
      })
      .populate({
        path: 'fleetID',
        model: 'Fleet',
        populate: [
          { path: 'carID', model: 'Car', select: '_id carName model' }
        ],
        select: '_id carLicenseNumber'
      })
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // Standardize response format (flattened)
    const formattedBooking = {
      ...booking,
    };

    res.json({
      success: true,
      message: 'Booking fetched successfully',
      data: formattedBooking
    });

  } catch (error) {
    console.error('Get booking by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking',
      error: error.message
    });
  }
}


// ============= CREATE HOURLY BOOKING =============
const createHourlyBooking = async (req, res) => {
  try {
    const customerID = req.customer?.customerId || req.body.customerID;
    if (!customerID) {
      return res.status(401).json({ success: false, message: 'Customer ID is required' });
    }

    const bookingData = { ...req.body, customerID };

    // Basic state
    bookingData.bookingStatus = 'pending';
    bookingData.TrackingTimeLine = ['booking_created'];
    bookingData.paymentStatus = false;

    // Process Date
    const now = new Date();
    bookingData.pickupDateTime = new Date(req.body.pickupDateTime);

    if (isNaN(bookingData.pickupDateTime.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    if (bookingData.pickupDateTime < new Date(now.getTime() - 5 * 60 * 1000)) {
      return res.status(400).json({ success: false, message: 'Pickup date and time cannot be in the past' });
    }

    // Handle Audio File
    if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio[0]) {
      const audioFile = req.files.specialRequestAudio[0];
      bookingData.specialRequestAudio = {
        key: audioFile.key,
        url: getS3Url(audioFile.key),
        originalName: audioFile.originalname,
        mimeType: audioFile.mimetype,
        size: audioFile.size
      };
    }

    const booking = new HourlyBooking(bookingData);
    await booking.save();

    // Notifications
    notificationQueue.add('customer_booking_confirmed', {
      type: 'user',
      recipientId: customerID,
      title: '✅ Hourly Booking Confirmed',
      body: `Your hourly booking for ${booking.hours} hours has been created.`,
      data: { type: 'booking_created', bookingId: booking._id.toString(), bookingType: 'hourly' }
    }).catch(err => console.error('Error adding hourly notification:', err));

    res.status(201).json({
      success: true,
      message: 'Hourly booking created successfully',
      data: booking
    });

  } catch (error) {
    console.error('Create hourly booking error:', error);
    res.status(500).json({ success: false, message: 'Error creating hourly booking', error: error.message });
  }
};

// ============= GET ALL HOURLY BOOKINGS =============
const getAllHourlyBookings = async (req, res) => {
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
      query.pickupDateTime = {};
      if (fromDate) query.pickupDateTime.$gte = new Date(fromDate);
      if (toDate) query.pickupDateTime.$lte = new Date(toDate);
    }

    const finalQuery = applyDispatcherCityFilter(req.admin, query);

    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const skipNum = (pageNum - 1) * limitNum;

    const total = await HourlyBooking.countDocuments(finalQuery);

    const bookings = await HourlyBooking.find(finalQuery)
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage fullPhoneNumber'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          { path: 'categoryID', model: 'Category', select: '_id name' },
          { path: 'brandID', model: 'Brand', select: '_id brandName' }
        ],
        select: '_id categoryID brandID carName model numberOfPassengers carImage'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips'
      })
      .populate({
        path: 'fleetID',
        model: 'Fleet',
        populate: [{ path: 'carID', model: 'Car', select: '_id carName model' }],
        select: '_id carLicenseNumber'
      })
      .sort({ createdAt: -1 })
      .limit(limitNum)
      .skip(skipNum)
      .lean();

    res.json({
      success: true,
      count: bookings.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: bookings
    });

  } catch (error) {
    console.error('Get hourly bookings error:', error);
    res.status(500).json({ success: false, message: 'Error fetching hourly bookings', error: error.message });
  }
};

// ============= GET HOURLY BOOKING BY ID =============
const getHourlyBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await HourlyBooking.findById(id)
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage fullPhoneNumber'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          { path: 'categoryID', model: 'Category', select: '_id name' },
          { path: 'brandID', model: 'Brand', select: '_id brandName' }
        ],
        select: '_id categoryID brandID carName model numberOfPassengers carImage'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips'
      })
      .populate({
        path: 'fleetID',
        model: 'Fleet',
        populate: [{ path: 'carID', model: 'Car', select: '_id carName model' }],
        select: '_id carLicenseNumber'
      })
      .lean();

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Hourly booking not found' });
    }

    res.json({
      success: true,
      message: 'Hourly booking fetched successfully',
      data: booking
    });

  } catch (error) {
    console.error('Get hourly booking by ID error:', error);
    res.status(500).json({ success: false, message: 'Error fetching hourly booking', error: error.message });
  }
};

// ============= UPDATE HOURLY BOOKING =============
const updateHourlyBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const customerId = req.customer?.customerId;

    if (!customerId) {
      return res.status(401).json({ success: false, message: 'Authentication failed' });
    }

    const existingBooking = await HourlyBooking.findOne({ _id: id, customerID: customerId });

    if (!existingBooking) {
      if (req.files?.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key);
      return res.status(404).json({ success: false, message: 'Hourly booking not found' });
    }

    const {
      hours, pickupDateTime, pickupLat, pickupLong, pickupAddress,
      carID, cityID, charge, passengerCount, passengerNames, passengerMobile,
      bookingStatus, transactionID, orderID, discountPercentage, vat,
      allowSimilarVehicle, specialRequestText
    } = req.body;

    const isValidValue = (value) => value !== undefined && value !== null && value !== '' && value !== 'null' && value !== 'undefined';

    const updateData = {};
    const timelineUpdates = [];

    // Mapping fields
    if (isValidValue(hours)) updateData.hours = Number(hours);
    if (isValidValue(pickupLat)) updateData.pickupLat = Number(pickupLat);
    if (isValidValue(pickupLong)) updateData.pickupLong = Number(pickupLong);
    if (isValidValue(pickupAddress)) updateData.pickupAddress = String(pickupAddress).trim();
    if (isValidValue(charge)) updateData.charge = Number(charge);
    if (isValidValue(passengerCount)) updateData.passengerCount = Number(passengerCount);
    if (isValidValue(passengerMobile)) updateData.passengerMobile = String(passengerMobile).trim();
    if (isValidValue(transactionID)) updateData.transactionID = String(transactionID).trim();
    if (isValidValue(orderID)) updateData.orderID = String(orderID).trim();
    if (discountPercentage !== undefined) updateData.discountPercentage = Number(discountPercentage);
    if (vat !== undefined) updateData.vat = Number(vat);
    if (allowSimilarVehicle !== undefined) updateData.allowSimilarVehicle = String(allowSimilarVehicle) === 'true';

    // ObjectIds
    if (isValidValue(carID) && mongoose.Types.ObjectId.isValid(carID)) updateData.carID = new mongoose.Types.ObjectId(carID);
    if (isValidValue(cityID) && mongoose.Types.ObjectId.isValid(cityID)) updateData.cityID = new mongoose.Types.ObjectId(cityID);

    // Date
    if (isValidValue(pickupDateTime)) {
      const parsedDate = new Date(pickupDateTime);
      if (!isNaN(parsedDate.getTime())) {
        updateData.pickupDateTime = parsedDate;
      }
    }

    // Status
    if (isValidValue(bookingStatus)) {
      const newStatus = String(bookingStatus).trim().toLowerCase();
      const allowed = ['pending', 'assigned', 'starttracking', 'completed', 'cancelled'];
      if (allowed.includes(newStatus)) {
        if (newStatus !== existingBooking.bookingStatus) {
          updateData.bookingStatus = newStatus;
          timelineUpdates.push(`status_changed_from_${existingBooking.bookingStatus}_to_${newStatus}_by_customer`);
        }
      }
    }

    // Passenger Names
    if (isValidValue(passengerNames)) {
      try {
        updateData.passengerNames = typeof passengerNames === 'string' ? JSON.parse(passengerNames) : passengerNames;
      } catch (e) {
        updateData.passengerNames = String(passengerNames).split(',').map(n => n.trim());
      }
    }

    // Audio
    if (req.files?.specialRequestAudio?.[0]) {
      if (existingBooking.specialRequestAudio?.key) {
        await deleteFromS3(existingBooking.specialRequestAudio.key).catch(console.error);
      }
      const audioFile = req.files.specialRequestAudio[0];
      updateData.specialRequestAudio = {
        key: audioFile.key,
        url: getS3Url(audioFile.key),
        originalName: audioFile.originalname,
        mimeType: audioFile.mimetype,
        size: audioFile.size
      };
    }

    if (isValidValue(specialRequestText)) updateData.specialRequestText = String(specialRequestText).trim();

    timelineUpdates.push('booking_updated_by_customer');

    const finalUpdate = { $set: updateData };
    if (timelineUpdates.length > 0) {
      finalUpdate.$push = { TrackingTimeLine: { $each: timelineUpdates } };
    }

    const updatedBooking = await HourlyBooking.findByIdAndUpdate(id, finalUpdate, { new: true, runValidators: true });

    // Notification
    notificationQueue.add('customer_booking_updated', {
      type: 'user',
      recipientId: customerId,
      title: '📝 Hourly Booking Updated',
      body: `Your hourly booking status is now ${updatedBooking.bookingStatus}.`,
      data: { type: 'booking_updated', bookingId: id, status: updatedBooking.bookingStatus }
    }).catch(console.error);

    res.json({ success: true, message: 'Hourly booking updated successfully', data: updatedBooking });

  } catch (error) {
    console.error('Update hourly booking error:', error);
    res.status(500).json({ success: false, message: 'Error updating hourly booking', error: error.message });
  }
};

module.exports = {
  createBooking,
  getAllBookings,
  getBookingById,
  createHourlyBooking,
  getAllHourlyBookings,
  getHourlyBookingById,
  updateHourlyBooking
};
