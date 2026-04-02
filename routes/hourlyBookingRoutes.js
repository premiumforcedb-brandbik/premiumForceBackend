const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const NotificationService = require('../services/notificationService');


// Make sure to import all required models at the top of your file
const Category = require('../models/categoryModel');
const Brand = require('../models/brandModel');
const Car = require('../models/car_model');
const City = require('../models/city_model');
const User = require('../models/users_model');
const Driver = require('../models/driver_model');
const HourlyBooking = require('../models/hourlyBookingModel');

const { authenticateDriver } = require('../middleware/driverware');

// // Helper function for notifications (implement as needed)
// const notifyUser = async (userId, title, body, data) => {
//   console.log(`Notification to ${userId}:`, { title, body, data });
//   // Implement your notification logic here
//   return true;
// };

const { notifyUser } = require('../fcm');

const { authenticateCustomer
} = require('../middleware/customermiddleware');



// POST /api/hourly-bookings - Create hourly booking
router.post('/',
  authenticateCustomer,
  (req, res, next) => {
    console.log('POST request received');
    console.log('Content-Type:', req.headers['content-type']);
    next();
  },
  (req, res, next) => {
    upload.fields([
      { name: 'carImage', maxCount: 1 },
      { name: 'specialRequestAudio', maxCount: 1 }
    ])(req, res, (err) => {
      if (err) {
        console.error('❌ Multer error:', err);
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('✅ Files received:', req.files);
      console.log('✅ Body received:', req.body);

      // Helper function to check if value is valid
      const isValidValue = (value) => {
        return value !== undefined &&
          value !== null &&
          value !== '' &&
          value !== 'null' &&
          value !== 'undefined';
      };

      const {
        hours, pickupLat, pickuplong, pickupAdddress,
        extraHours, model, categoryID, brandID, carID, cityID,
        charge, customerID, driverID, passsenrgersCount,
        passengerMobile, carClass, specialRequestText,
        bookingStatus, passengerNames, isActive,
        transactionID, orderID, discountPercentage, pickupDateTime,
        stoppedAt, startedAt, extraPayment, extraTransactionID, extraOrderID,
        extraDiscount, extraPaymentCompleted
      } = req.body;

      // ========== REQUIRED FIELDS VALIDATION ==========
      const requiredFields = {
        hours: hours,
        pickupLat: pickupLat,
        pickuplong: pickuplong,
        pickupAdddress: pickupAdddress,
        pickupDateTime: pickupDateTime,
        model: model,
        categoryID: categoryID,
        brandID: brandID,
        carID: carID,
        cityID: cityID,
        charge: charge,
        customerID: customerID,
        passsenrgersCount: passsenrgersCount,
        passengerMobile: passengerMobile,
        carClass: carClass,
        transactionID: transactionID,
        orderID: orderID
      };

      const missingFields = [];
      const emptyFields = [];

      // Check each required field
      for (const [field, value] of Object.entries(requiredFields)) {
        if (!isValidValue(value)) {
          missingFields.push(field);
        } else if (typeof value === 'string' && value.trim() === '') {
          emptyFields.push(field);
        }
      }

      if (missingFields.length > 0 || emptyFields.length > 0) {
        // Delete uploaded files if validation fails
        if (req.files) {
          if (req.files.carImage) {
            await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          }
          if (req.files.specialRequestAudio) {
            await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
        }

        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields',
          required: Object.keys(requiredFields),
          missing: missingFields,
          empty: emptyFields,
          received: Object.keys(req.body)
        });
      }

      // ========== VALIDATE OBJECT ID FORMAT ==========
      if (!mongoose.Types.ObjectId.isValid(categoryID)) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid categoryID format. Must be a valid ObjectId.' 
        });
      }
      
      if (!mongoose.Types.ObjectId.isValid(brandID)) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid brandID format. Must be a valid ObjectId.' 
        });
      }
      
      if (!mongoose.Types.ObjectId.isValid(carID)) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid carID format. Must be a valid ObjectId.' 
        });
      }
      
      if (!mongoose.Types.ObjectId.isValid(cityID)) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid cityID format. Must be a valid ObjectId.' 
        });
      }
      
      if (!mongoose.Types.ObjectId.isValid(customerID)) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid customerID format. Must be a valid ObjectId.' 
        });
      }
      
      // if (driverID && isValidValue(driverID) && driverID !== 'null' && driverID !== 'undefined') {
      //   if (!mongoose.Types.ObjectId.isValid(driverID)) {
      //     if (req.files) {
      //       if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
      //       if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
      //     }
      //     return res.status(400).json({ 
      //       success: false, 
      //       message: 'Invalid driverID format. Must be a valid ObjectId.' 
      //     });
      //   }
      // }

      // ========== CHECK IF REFERENCE IDs EXIST IN DATABASE ==========
      
      // Import models at the top of your file (make sure these are imported)
      // const Category = require('../models/Category');
      // const Brand = require('../models/Brand');
      // const Car = require('../models/Car');
      // const City = require('../models/City');
      // const User = require('../models/User');
      // const Driver = require('../models/Driver');

      // Check Category exists
      const categoryExists = await Category.findById(categoryID);
      if (!categoryExists) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(404).json({
          success: false,
          message: 'Category not found with the provided categoryID'
        });
      }

      // Check Brand exists
      const brandExists = await Brand.findById(brandID);
      if (!brandExists) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(404).json({
          success: false,
          message: 'Brand not found with the provided brandID'
        });
      }

      // Check Car exists
      const carExists = await Car.findById(carID);
      if (!carExists) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(404).json({
          success: false,
          message: 'Car not found with the provided carID'
        });
      }

      // Check City exists
      const cityExists = await City.findById(cityID);
      if (!cityExists) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(404).json({
          success: false,
          message: 'City not found with the provided cityID'
        });
      }

      // Check Customer exists
      const customerExists = await User.findById(customerID);
      if (!customerExists) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(404).json({
          success: false,
          message: 'Customer not found with the provided customerID'
        });
      }

      // Check Driver exists if provided
      // if (driverID && isValidValue(driverID) && driverID !== 'null' && driverID !== 'undefined') {
      //   const driverExists = await Driver.findById(driverID);
      //   if (!driverExists) {
      //     if (req.files) {
      //       if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
      //       if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
      //     }
      //     return res.status(404).json({
      //       success: false,
      //       message: 'Driver not found with the provided driverID'
      //     });
      //   }
      // }

      // ========== EXISTING BOOKING CHECK ==========
      const activeBooking = await HourlyBooking.findOne({
        customerID: String(customerID).trim(),
        bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
        isActive: true
      });

      if (activeBooking) {
        if (req.files) {
          if (req.files.carImage) {
            await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          }
          if (req.files.specialRequestAudio) {
            await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
        }

        try {
          await notifyUser(
            String(customerID).trim(),
            '📅 Booking Already Exists',
            `You already have an active booking. Please complete or cancel it before creating a new one.`,
            {
              type: 'booking_exists',
              bookingId: activeBooking._id.toString(),
              status: activeBooking.bookingStatus
            }
          );
        } catch (notifyError) {
          console.error('Notification error:', notifyError);
        }

        return res.status(409).json({
          success: false,
          message: 'Customer already has an active booking',
          data: {
            existingBookingId: activeBooking._id,
            existingStatus: activeBooking.bookingStatus,
            message: 'Please complete or cancel your existing booking before creating a new one'
          }
        });
      }

      // ========== PARSE PASSENGER NAMES ==========
      let parsedPassengerNames = [];
      if (passengerNames && isValidValue(passengerNames)) {
        if (typeof passengerNames === 'string') {
          if (passengerNames.trim().startsWith('[')) {
            try {
              parsedPassengerNames = JSON.parse(passengerNames);
            } catch (e) {
              parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
            }
          } else {
            parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
          }
        } else if (Array.isArray(passengerNames)) {
          parsedPassengerNames = passengerNames;
        }
      }

      // ========== HANDLE CAR IMAGE (OPTIONAL) ==========
      let carImageUrl = null;
      if (req.files && req.files.carImage && req.files.carImage.length > 0) {
        carImageUrl = getS3Url(req.files.carImage[0].key);
        console.log('Using uploaded car image:', carImageUrl);
      } else if (req.body.carImage && isValidValue(req.body.carImage)) {
        carImageUrl = String(req.body.carImage).trim();
        console.log('Using car image URL from body:', carImageUrl);
      }

      // ========== HANDLE AUDIO (OPTIONAL) ==========
      let audioUrl = null;
      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio.length > 0) {
        audioUrl = getS3Url(req.files.specialRequestAudio[0].key);
        console.log('Using uploaded audio:', audioUrl);
      } else if (req.body.specialRequestAudio && isValidValue(req.body.specialRequestAudio)) {
        audioUrl = String(req.body.specialRequestAudio).trim();
        console.log('Using audio URL from body:', audioUrl);
      }

      // ========== PARSE NUMERIC VALUES ==========
      const parsedHours = parseInt(hours);
      const parsedPickupLat = parseFloat(pickupLat);
      const parsedPickuplong = parseFloat(pickuplong);
      const parsedCharge = parseFloat(charge);
      const parsedPassengersCount = parseInt(passsenrgersCount);
      const parsedExtraHours = extraHours && isValidValue(extraHours) ? parseInt(extraHours) : 0;
      const parsedDiscountPercentage = discountPercentage && isValidValue(discountPercentage) ? parseFloat(discountPercentage) : 0;

      // Validate numeric values
      if (isNaN(parsedHours) || parsedHours <= 0) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid hours value. Must be a positive number'
        });
      }

      if (isNaN(parsedPickupLat) || isNaN(parsedPickuplong)) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid coordinates. Pickup latitude and longitude must be valid numbers'
        });
      }

      if (isNaN(parsedCharge) || parsedCharge <= 0) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid charge value. Must be a positive number'
        });
      }

      if (isNaN(parsedPassengersCount) || parsedPassengersCount < 1) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid passenger count. Must be at least 1'
        });
      }

      // ========== PARSE OPTIONAL FIELDS ==========
      let parsedExtraPayment = 0;
      if (extraPayment && isValidValue(extraPayment)) {
        parsedExtraPayment = parseFloat(extraPayment);
        if (isNaN(parsedExtraPayment)) parsedExtraPayment = 0;
      }

      let parsedExtraDiscount = 0;
      if (extraDiscount && isValidValue(extraDiscount)) {
        parsedExtraDiscount = parseFloat(extraDiscount);
        if (isNaN(parsedExtraDiscount)) parsedExtraDiscount = 0;
      }

      let parsedExtraPaymentCompleted = false;
      if (extraPaymentCompleted && isValidValue(extraPaymentCompleted)) {
        parsedExtraPaymentCompleted = extraPaymentCompleted === 'true' ||
          extraPaymentCompleted === true ||
          extraPaymentCompleted === '1';
      }

      let parsedStartedAt = null;
      if (startedAt && isValidValue(startedAt) && startedAt !== 'null' && startedAt !== 'undefined') {
        parsedStartedAt = new Date(startedAt);
        if (isNaN(parsedStartedAt.getTime())) parsedStartedAt = null;
      }

      let parsedStoppedAt = null;
      if (stoppedAt && isValidValue(stoppedAt) && stoppedAt !== 'null' && stoppedAt !== 'undefined') {
        parsedStoppedAt = new Date(stoppedAt);
        if (isNaN(parsedStoppedAt.getTime())) parsedStoppedAt = null;
      }

      let parsedExtraTransactionID = null;
      if (extraTransactionID && isValidValue(extraTransactionID) &&
        extraTransactionID !== 'null' && extraTransactionID !== 'undefined') {
        parsedExtraTransactionID = String(extraTransactionID).trim();
      }

      let parsedExtraOrderID = null;
      if (extraOrderID && isValidValue(extraOrderID) &&
        extraOrderID !== 'null' && extraOrderID !== 'undefined') {
        parsedExtraOrderID = String(extraOrderID).trim();
      }

      // ========== CREATE BOOKING OBJECT ==========
      const bookingData = {
        hours: parsedHours,
        pickupLat: parsedPickupLat,
        pickuplong: parsedPickuplong,
        pickupAdddress: String(pickupAdddress).trim(),
        pickupDateTime: new Date(pickupDateTime),
        extraHours: parsedExtraHours,
        model: String(model).trim(),
        categoryID: categoryID,
        brandID: brandID,
        carID: carID,
        cityID: cityID,
        charge: parsedCharge,
        customerID: customerID,
        passsenrgersCount: parsedPassengersCount,
        passengerMobile: String(passengerMobile).trim(),
        carClass: String(carClass).trim(),
        transactionID: String(transactionID).trim(),
        orderID: String(orderID).trim(),
        discountPercentage: parsedDiscountPercentage,
        extraPayment: parsedExtraPayment,
        extraTransactionID: parsedExtraTransactionID,
        extraOrderID: parsedExtraOrderID,
        extraDiscount: parsedExtraDiscount,
        extraPaymentCompleted: parsedExtraPaymentCompleted,
        startedAt: parsedStartedAt,
        stoppedAt: parsedStoppedAt,
        bookingStatus: bookingStatus && isValidValue(bookingStatus) ? String(bookingStatus).trim().toLowerCase() : 'pending',
        isActive: isActive === 'true' || isActive === true,
        passengerNames: parsedPassengerNames,
        specialRequestText: specialRequestText && isValidValue(specialRequestText) ? String(specialRequestText).trim() : ''
      };

      // Add optional fields
      if (carImageUrl) {
        bookingData.carImage = carImageUrl;
      }
      if (audioUrl) {
        bookingData.specialRequestAudio = audioUrl;
      }
      if (driverID && isValidValue(driverID) && driverID !== 'null' && driverID !== 'undefined') {
        bookingData.driverID = driverID;
      }

      console.log('Final booking data:', JSON.stringify(bookingData, null, 2));

      // Create and save the booking
      const booking = new HourlyBooking(bookingData);
      const savedBooking = await booking.save();

      // Send notification
      try {
        await notifyUser(
          savedBooking.customerID,
          '📅 Booking Created',
          `Your hourly booking for ${savedBooking.model} has been created successfully.`,
          {
            type: 'booking_created',
            bookingId: savedBooking._id.toString(),
            status: savedBooking.bookingStatus
          }
        );
      } catch (notifyError) {
        console.error('Notification error:', notifyError);
      }

      res.status(201).json({
        success: true,
        message: 'Hourly booking created successfully',
        data: savedBooking
      });

    } catch (error) {
      console.error('Create booking error:', error);

      // Delete uploaded files if error occurs
      if (req.files) {
        if (req.files.carImage) {
          await deleteFromS3(req.files.carImage[0].key).catch(console.error);
        }
        if (req.files.specialRequestAudio) {
          await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
      }

      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: Object.keys(error.errors).reduce((acc, key) => {
            acc[key] = error.errors[key].message;
            return acc;
          }, {})
        });
      }

      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'Duplicate booking detected',
          error: 'A booking with these details already exists'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error creating hourly booking',
        error: error.message
      });
    }
  });



// PUT /api/hourly-bookings/:id - Update hourly booking
router.put('/:id',
  authenticateCustomer,
  (req, res, next) => {
    console.log('PUT request received');
    console.log('Booking ID:', req.params.id);
    console.log('Content-Type:', req.headers['content-type']);
    next();
  },
  
  (req, res, next) => {
    upload.fields([
      { name: 'carImage', maxCount: 1 },
      { name: 'specialRequestAudio', maxCount: 1 }
    ])(req, res, (err) => {
      if (err) {
        console.error('❌ Multer error:', err);
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('✅ Files received:', req.files);
      console.log('✅ Body received:', req.body);

      const { id } = req.params;

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Helper function to check if value is valid
      const isValidValue = (value) => {
        return value !== undefined &&
          value !== null &&
          value !== '' &&
          value !== 'null' &&
          value !== 'undefined';
      };

      // Check if booking exists
      const existingBooking = await HourlyBooking.findById(id);
      if (!existingBooking) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Extract fields from request body
      const {
        hours, pickupLat, pickuplong, pickupAdddress,
        extraHours, model, categoryID, brandID, carID, cityID,
        charge, customerID, driverID, passsenrgersCount,
        passengerMobile, carClass, specialRequestText,
        bookingStatus, passengerNames, isActive,
        transactionID, orderID, discountPercentage, pickupDateTime,
        stoppedAt, startedAt, extraPayment, extraTransactionID, extraOrderID,
        extraDiscount, extraPaymentCompleted
      } = req.body;

      // Build update object
      const updateData = {};

      // ========== VALIDATE AND UPDATE REGULAR FIELDS ==========
      
      // Handle hours
      if (isValidValue(hours)) {
        const parsedHours = parseInt(hours);
        if (!isNaN(parsedHours) && parsedHours > 0) {
          updateData.hours = parsedHours;
        } else {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid hours value. Must be a positive number'
          });
        }
      }

      // Handle pickup coordinates
      if (isValidValue(pickupLat) && isValidValue(pickuplong)) {
        const parsedPickupLat = parseFloat(pickupLat);
        const parsedPickuplong = parseFloat(pickuplong);
        if (!isNaN(parsedPickupLat) && !isNaN(parsedPickuplong)) {
          updateData.pickupLat = parsedPickupLat;
          updateData.pickuplong = parsedPickuplong;
        } else {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid coordinates. Pickup latitude and longitude must be valid numbers'
          });
        }
      }

      // Handle pickup address
      if (isValidValue(pickupAdddress)) {
        updateData.pickupAdddress = String(pickupAdddress).trim();
      }

      // Handle pickup date time
      if (isValidValue(pickupDateTime)) {
        updateData.pickupDateTime = new Date(pickupDateTime);
      }

      // Handle model
      if (isValidValue(model)) {
        updateData.model = String(model).trim();
      }

      // Handle charge
      if (isValidValue(charge)) {
        const parsedCharge = parseFloat(charge);
        if (!isNaN(parsedCharge) && parsedCharge > 0) {
          updateData.charge = parsedCharge;
        } else {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid charge value. Must be a positive number'
          });
        }
      }

      // Handle passenger count
      if (isValidValue(passsenrgersCount)) {
        const parsedPassengersCount = parseInt(passsenrgersCount);
        if (!isNaN(parsedPassengersCount) && parsedPassengersCount >= 1) {
          updateData.passsenrgersCount = parsedPassengersCount;
        } else {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid passenger count. Must be at least 1'
          });
        }
      }

      // Handle passenger mobile
      if (isValidValue(passengerMobile)) {
        updateData.passengerMobile = String(passengerMobile).trim();
      }

      // Handle car class
      if (isValidValue(carClass)) {
        updateData.carClass = String(carClass).trim();
      }

      // Handle extra hours
      if (isValidValue(extraHours)) {
        const parsedExtraHours = parseInt(extraHours);
        if (!isNaN(parsedExtraHours)) {
          updateData.extraHours = parsedExtraHours;
        }
      }

      // Handle transaction and order IDs
      if (isValidValue(transactionID)) {
        updateData.transactionID = String(transactionID).trim();
      }
      if (isValidValue(orderID)) {
        updateData.orderID = String(orderID).trim();
      }

      // Handle booking status
      if (isValidValue(bookingStatus)) {
           const validStatuses = ['pending', 'assigned', 'starttrack','stoptrack', 'completed',
        'paymentPending', 'reviewed', 'cancelled'];
        const status = String(bookingStatus).trim().toLowerCase();
        if (validStatuses.includes(status)) {
          updateData.bookingStatus = status;
        } else {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid booking status. Must be one of:pending, assigned, started, stopped, completed, paymentPending, reviewed, cancelled'
          });
        }
      }


      // Handle isActive
      if (isValidValue(isActive)) {
        updateData.isActive = isActive === 'true' || isActive === true;
      }

      // Handle special request text
      if (isValidValue(specialRequestText)) {
        updateData.specialRequestText = String(specialRequestText).trim();
      }

      // Handle discount percentage
      if (isValidValue(discountPercentage)) {
        const parsedDiscount = parseFloat(discountPercentage);
        if (!isNaN(parsedDiscount)) {
          updateData.discountPercentage = parsedDiscount;
        }
      }

      // ========== VALIDATE AND UPDATE REFERENCE IDs ==========
      
      // Handle categoryID
      if (isValidValue(categoryID)) {
        if (!mongoose.Types.ObjectId.isValid(categoryID)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({ 
            success: false, 
            message: 'Invalid categoryID format. Must be a valid ObjectId.' 
          });
        }
        
        const categoryExists = await Category.findById(categoryID);
        if (!categoryExists) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(404).json({
            success: false,
            message: 'Category not found with the provided categoryID'
          });
        }
        updateData.categoryID = categoryID;
      }

      // Handle brandID
      if (isValidValue(brandID)) {
        if (!mongoose.Types.ObjectId.isValid(brandID)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({ 
            success: false, 
            message: 'Invalid brandID format. Must be a valid ObjectId.' 
          });
        }
        
        const brandExists = await Brand.findById(brandID);
        if (!brandExists) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(404).json({
            success: false,
            message: 'Brand not found with the provided brandID'
          });
        }
        updateData.brandID = brandID;
      }

      // Handle carID
      if (isValidValue(carID)) {
        if (!mongoose.Types.ObjectId.isValid(carID)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({ 
            success: false, 
            message: 'Invalid carID format. Must be a valid ObjectId.' 
          });
        }
        
        const carExists = await Car.findById(carID);
        if (!carExists) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(404).json({
            success: false,
            message: 'Car not found with the provided carID'
          });
        }
        updateData.carID = carID;
      }

      // Handle cityID
      if (isValidValue(cityID)) {
        if (!mongoose.Types.ObjectId.isValid(cityID)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({ 
            success: false, 
            message: 'Invalid cityID format. Must be a valid ObjectId.' 
          });
        }
        
        const cityExists = await City.findById(cityID);
        if (!cityExists) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(404).json({
            success: false,
            message: 'City not found with the provided cityID'
          });
        }
        updateData.cityID = cityID;
      }

      // Handle customerID
      if (isValidValue(customerID)) {
        if (!mongoose.Types.ObjectId.isValid(customerID)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({ 
            success: false, 
            message: 'Invalid customerID format. Must be a valid ObjectId.' 
          });
        }
        
        const customerExists = await User.findById(customerID);
        if (!customerExists) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(404).json({
            success: false,
            message: 'Customer not found with the provided customerID'
          });
        }
        updateData.customerID = customerID;
      }

      // Handle driverID (optional)
      if (isValidValue(driverID) && driverID !== 'null' && driverID !== 'undefined') {
        if (!mongoose.Types.ObjectId.isValid(driverID)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({ 
            success: false, 
            message: 'Invalid driverID format. Must be a valid ObjectId.' 
          });
        }
        
        const driverExists = await Driver.findById(driverID);
        if (!driverExists) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(404).json({
            success: false,
            message: 'Driver not found with the provided driverID'
          });
        }
        updateData.driverID = driverID;
      }

      // ========== HANDLE PASSENGER NAMES ==========
      if (isValidValue(passengerNames)) {
        let parsedPassengerNames = [];
        if (typeof passengerNames === 'string') {
          if (passengerNames.trim().startsWith('[')) {
            try {
              parsedPassengerNames = JSON.parse(passengerNames);
            } catch (e) {
              parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
            }
          } else {
            parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
          }
        } else if (Array.isArray(passengerNames)) {
          parsedPassengerNames = passengerNames;
        }
        updateData.passengerNames = parsedPassengerNames;
      }

      // ========== HANDLE CAR IMAGE ==========
      if (req.files && req.files.carImage && req.files.carImage.length > 0) {
        // Delete old image from S3 if exists
        if (existingBooking.carImage) {
          const oldKey = existingBooking.carImage.split('/').pop();
          await deleteFromS3(oldKey).catch(console.error);
        }
        updateData.carImage = getS3Url(req.files.carImage[0].key);
        console.log('Updated car image:', updateData.carImage);
      } else if (req.body.carImage && isValidValue(req.body.carImage)) {
        updateData.carImage = String(req.body.carImage).trim();
        console.log('Updated car image URL from body:', updateData.carImage);
      }

      // ========== HANDLE AUDIO FILE ==========
      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio.length > 0) {
        // Delete old audio from S3 if exists
        if (existingBooking.specialRequestAudio) {
          const oldKey = existingBooking.specialRequestAudio.split('/').pop();
          await deleteFromS3(oldKey).catch(console.error);
        }
        updateData.specialRequestAudio = getS3Url(req.files.specialRequestAudio[0].key);
        console.log('Updated audio:', updateData.specialRequestAudio);
      } else if (req.body.specialRequestAudio && isValidValue(req.body.specialRequestAudio)) {
        updateData.specialRequestAudio = String(req.body.specialRequestAudio).trim();
        console.log('Updated audio URL from body:', updateData.specialRequestAudio);
      }

      // ========== HANDLE EXTRA PAYMENT FIELDS ==========
      if (isValidValue(extraPayment)) {
        const parsedExtraPayment = parseFloat(extraPayment);
        updateData.extraPayment = !isNaN(parsedExtraPayment) ? parsedExtraPayment : 0;
      }

      if (isValidValue(extraDiscount)) {
        const parsedExtraDiscount = parseFloat(extraDiscount);
        updateData.extraDiscount = !isNaN(parsedExtraDiscount) ? parsedExtraDiscount : 0;
      }

      if (isValidValue(extraPaymentCompleted)) {
        updateData.extraPaymentCompleted = extraPaymentCompleted === 'true' ||
          extraPaymentCompleted === true ||
          extraPaymentCompleted === '1';
      }

      if (isValidValue(extraTransactionID) && extraTransactionID !== 'null' && extraTransactionID !== 'undefined') {
        updateData.extraTransactionID = String(extraTransactionID).trim();
      }

      if (isValidValue(extraOrderID) && extraOrderID !== 'null' && extraOrderID !== 'undefined') {
        updateData.extraOrderID = String(extraOrderID).trim();
      }

      // ========== HANDLE STARTED AT AND STOPPED AT ==========
      if (isValidValue(startedAt) && startedAt !== 'null' && startedAt !== 'undefined') {
        const parsedStartedAt = new Date(startedAt);
        if (!isNaN(parsedStartedAt.getTime())) {
          updateData.startedAt = parsedStartedAt;
        }
      }

      if (isValidValue(stoppedAt) && stoppedAt !== 'null' && stoppedAt !== 'undefined') {
        const parsedStoppedAt = new Date(stoppedAt);
        if (!isNaN(parsedStoppedAt.getTime())) {
          updateData.stoppedAt = parsedStoppedAt;
        }
      }

      // Check if there's anything to update
      if (Object.keys(updateData).length === 0) {
        if (req.files) {
          if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
        return res.status(400).json({
          success: false,
          message: 'No valid fields provided for update'
        });
      }

      // Add updated timestamp
      updateData.updatedAt = new Date();

      console.log('Final update data:', JSON.stringify(updateData, null, 2));

      // Update the booking
      const updatedBooking = await HourlyBooking.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!updatedBooking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // Send notification for status change
      if (updateData.bookingStatus && updateData.bookingStatus !== existingBooking.bookingStatus) {
        try {
          let statusMessage = '';
          switch (updateData.bookingStatus) {
            case 'stoptrack':
              statusMessage = 'Your booking has been stopped!';
              break;
            case 'starttrack':
              statusMessage = 'Your ride has started!';
              break;
            case 'completed':
              statusMessage = 'Your ride is complete. Thank you for booking with us!';
              break;
            case 'cancelled':
              statusMessage = 'Your booking has been cancelled.';
              break;
            default:
              statusMessage = `Your booking status has been updated to ${updateData.bookingStatus}`;
          }
          
          await notifyUser(
            updatedBooking.customerID,
            '📅 Booking Updated',
            statusMessage,
            {
              type: 'booking_updated',
              bookingId: updatedBooking._id.toString(),
              oldStatus: existingBooking.bookingStatus,
              newStatus: updateData.bookingStatus
            }
          );
        } catch (notifyError) {
          console.error('Notification error:', notifyError);
        }
      }

      res.status(200).json({
        success: true,
        message: 'Hourly booking updated successfully',
        data: updatedBooking
      });

    } catch (error) {
      console.error('Update booking error:', error);

      // Delete uploaded files if error occurs
      if (req.files) {
        if (req.files.carImage) {
          await deleteFromS3(req.files.carImage[0].key).catch(console.error);
        }
        if (req.files.specialRequestAudio) {
          await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
        }
      }

      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: Object.keys(error.errors).reduce((acc, key) => {
            acc[key] = error.errors[key].message;
            return acc;
          }, {})
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating hourly booking',
        error: error.message
      });
    }
  }
);




// // PUT /api/hourly-bookings/:id - Update hourly booking
// router.put('/:id',
//   authenticateCustomer,
//   (req, res, next) => {
//     console.log('🔵 PUT request received for ID:', req.params.id);
//     console.log('Content-Type:', req.headers['content-type']);
//     next();
//   },
//   (req, res, next) => {
//     upload.fields([
//       { name: 'carImage', maxCount: 1 },
//       { name: 'specialRequestAudio', maxCount: 1 }
//     ])(req, res, (err) => {
//       if (err) {
//         console.error('❌ Multer error:', err);
//         return res.status(400).json({
//           success: false,
//           message: 'File upload error',
//           error: err.message
//         });
//       }
//       next();
//     });
//   },
//   async (req, res) => {
//     try {
//       const bookingId = req.params.id;

//       console.log('📦 Update booking ID:', bookingId);
//       console.log('📁 Files received:', req.files ? Object.keys(req.files) : 'No files');
//       console.log('📝 Body received:', req.body);

//       // Helper function to check if value is valid
//       const isValidValue = (value) => {
//         return value !== undefined &&
//           value !== null &&
//           value !== '' &&
//           value !== 'null' &&
//           value !== 'undefined';
//       };

//       // Validate booking ID
//       if (!mongoose.Types.ObjectId.isValid(bookingId)) {
//         // Delete uploaded files if validation fails
//         if (req.files) {
//           if (req.files.carImage) {
//             await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//           }
//           if (req.files.specialRequestAudio) {
//             await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid booking ID format'
//         });
//       }

//       // Find existing booking
//       const existingBooking = await HourlyBooking.findById(bookingId);

//       if (!existingBooking) {
//         // Delete uploaded files if booking not found
//         if (req.files) {
//           if (req.files.carImage) {
//             await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//           }
//           if (req.files.specialRequestAudio) {
//             await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//         }
//         return res.status(404).json({
//           success: false,
//           message: 'Booking not found'
//         });
//       }

//       console.log('Existing booking:', {
//         id: existingBooking._id,
//         status: existingBooking.bookingStatus,
//         customerID: existingBooking.customerID
//       });

//       // ========== EXISTING BOOKING CHECK FOR UPDATE ==========
//       // Check if trying to update a completed booking
//       if (existingBooking.bookingStatus === 'completed') {
//         if (req.files) {
//           if (req.files.carImage) {
//             await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//           }
//           if (req.files.specialRequestAudio) {
//             await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Cannot update a completed booking',
//           currentStatus: existingBooking.bookingStatus
//         });
//       }

//       // Extract fields from request body
//       const {
//         hours, pickupLat, pickuplong, pickupAdddress,
//         extraHours, category, model, brand, carName,
//         charge, customerID, driverID, passsenrgersCount,
//         passengerMobile, carClass, specialRequestText,
//         bookingStatus, passengerNames, isActive,
//         transactionID, orderID, discountPercentage,
//         pickupDateTime, extraPayment, startedAt, stoppedAt,
//         extratransactionID, extraorderID, exDiscount, extraPaymentCompleted

//       } = req.body;

//       // Build update object
//       const updateData = {};

//       // ========== VALIDATE AND UPDATE FIELDS ==========

//       // Numeric fields
//       if (isValidValue(hours)) {
//         const parsedHours = parseInt(hours);
//         if (isNaN(parsedHours) || parsedHours <= 0) {
//           if (req.files) {
//             if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid hours value. Must be a positive number'
//           });
//         }
//         updateData.hours = parsedHours;
//       }

//       if (isValidValue(pickupLat)) {
//         const parsedPickupLat = parseFloat(pickupLat);
//         if (isNaN(parsedPickupLat)) {
//           if (req.files) {
//             if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid pickup latitude value'
//           });
//         }
//         updateData.pickupLat = parsedPickupLat;
//       }

//       if (isValidValue(pickuplong)) {
//         const parsedPickuplong = parseFloat(pickuplong);
//         if (isNaN(parsedPickuplong)) {
//           if (req.files) {
//             if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid pickup longitude value'
//           });
//         }
//         updateData.pickuplong = parsedPickuplong;
//       }

//       if (isValidValue(charge)) {
//         const parsedCharge = parseFloat(charge);
//         if (isNaN(parsedCharge) || parsedCharge <= 0) {
//           if (req.files) {
//             if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid charge value. Must be a positive number'
//           });
//         }
//         updateData.charge = parsedCharge;
//       }

//       if (isValidValue(passsenrgersCount)) {
//         const parsedPassengersCount = parseInt(passsenrgersCount);
//         if (isNaN(parsedPassengersCount) || parsedPassengersCount < 1) {
//           if (req.files) {
//             if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//           return res.status(400).json({
//             success: false,
//             message: 'Invalid passenger count. Must be at least 1'
//           });
//         }
//         updateData.passsenrgersCount = parsedPassengersCount;
//       }

//       if (isValidValue(extraHours)) {
//         updateData.extraHours = parseInt(extraHours);
//       }

//       if (isValidValue(discountPercentage)) {
//         updateData.discountPercentage = parseFloat(discountPercentage);
//       }

//       // String fields
//       if (isValidValue(pickupAdddress)) updateData.pickupAdddress = String(pickupAdddress).trim();
//       if (isValidValue(category)) updateData.category = String(category).trim();
//       if (isValidValue(model)) updateData.model = String(model).trim();
//       if (isValidValue(brand)) updateData.brand = String(brand).trim();
//       if (isValidValue(carName)) updateData.carName = String(carName).trim();
//       if (isValidValue(passengerMobile)) updateData.passengerMobile = String(passengerMobile).trim();
//       if (isValidValue(carClass)) updateData.carClass = String(carClass).trim();
//       if (isValidValue(transactionID)) updateData.transactionID = String(transactionID).trim();
//       if (isValidValue(orderID)) updateData.orderID = String(orderID).trim();
//       if (isValidValue(pickupDateTime)) updateData.pickupDateTime =
//         new Date(pickupDateTime);

//       // Special request text (can be empty)
//       if (specialRequestText !== undefined) {
//         updateData.specialRequestText = isValidValue(specialRequestText) ? String(specialRequestText).trim() : '';
//       }

//       // Boolean
//       if (isActive !== undefined) {
//         updateData.isActive = isActive === 'true' || isActive === true;
//       }

//       // Handle customerID - Check if changing
//       if (isValidValue(customerID) && customerID !== existingBooking.customerID) {
//         // Check if new customer has active booking
//         const customerActiveBooking = await HourlyBooking.findOne({
//           _id: { $ne: bookingId },
//           customerID: String(customerID).trim(),
//           bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
//           isActive: true
//         });

//         if (customerActiveBooking) {
//           if (req.files) {
//             if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//           return res.status(409).json({
//             success: false,
//             message: 'New customer already has an active booking',
//             data: {
//               existingBookingId: customerActiveBooking._id,
//               existingStatus: customerActiveBooking.bookingStatus
//             }
//           });
//         }
//         updateData.customerID = String(customerID).trim();
//       }

//       // Handle driverID (optional)
//       if (driverID !== undefined) {
//         if (!isValidValue(driverID) || driverID === 'null' || driverID === 'undefined') {
//           updateData.driverID = null;
//         } else if (mongoose.Types.ObjectId.isValid(driverID)) {
//           // Check if driver is already assigned to another active booking
//           const driverActiveBooking = await HourlyBooking.findOne({
//             _id: { $ne: bookingId },
//             driverID: driverID,
//             bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
//             isActive: true
//           });

//           if (driverActiveBooking) {
//             if (req.files) {
//               if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//               if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//             }
//             return res.status(409).json({
//               success: false,
//               message: 'Driver already assigned to another active booking',
//               data: {
//                 existingBookingId: driverActiveBooking._id,
//                 existingStatus: driverActiveBooking.bookingStatus
//               }
//             });
//           }
//           updateData.driverID = driverID;
//         }
//       }

//       // Handle bookingStatus
//       if (isValidValue(bookingStatus)) {
//         const newStatus = String(bookingStatus).trim().toLowerCase();
//         const validStatuses = ['pending', 'starttracking', 'completed', 'cancelled'];

//         if (!validStatuses.includes(newStatus)) {
//           if (req.files) {
//             if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//             if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//           }
//           return res.status(400).json({
//             success: false,
//             message: `Invalid status value: "${bookingStatus}"`,
//             validStatuses: validStatuses
//           });
//         }

//         // Define valid transitions
//         const validTransitions = {
//           'pending': ['completed', 'cancelled'],
//           'completed': ['starttracking', 'cancelled'],
//           'starttracking': ['completed'],
//           'cancelled': []
//         };

//         // Check if transition is valid
//         if (newStatus !== existingBooking.bookingStatus) {
//           if (validTransitions[existingBooking.bookingStatus]?.includes(newStatus)) {
//             updateData.bookingStatus = newStatus;
//           } else {
//             if (req.files) {
//               if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//               if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//             }
//             return res.status(400).json({
//               success: false,
//               message: `Invalid status transition from "${existingBooking.bookingStatus}" to "${bookingStatus}"`,
//               allowedTransitions: validTransitions[existingBooking.bookingStatus] || []
//             });
//           }
//         }
//       }

//       // Handle passengerNames
//       if (isValidValue(passengerNames)) {
//         let parsedPassengerNames = [];
//         if (typeof passengerNames === 'string') {
//           if (passengerNames.trim().startsWith('[')) {
//             try {
//               parsedPassengerNames = JSON.parse(passengerNames);
//             } catch (e) {
//               parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
//             }
//           } else {
//             parsedPassengerNames = passengerNames.split(',').map(name => name.trim());
//           }
//         } else if (Array.isArray(passengerNames)) {
//           parsedPassengerNames = passengerNames;
//         }
//         updateData.passengerNames = parsedPassengerNames;
//       }

//       // Handle car image (OPTIONAL - can be from file upload or URL)
//       if (req.files && req.files.carImage && req.files.carImage.length > 0) {
//         // Delete old image from S3 if exists
//         if (existingBooking.carImage && typeof existingBooking.carImage === 'string') {
//           const extractKeyFromUrl = (url) => {
//             if (!url) return null;
//             try {
//               const urlObj = new URL(url);
//               return urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
//             } catch (error) {
//               const parts = url.split('.amazonaws.com/');
//               return parts.length > 1 ? parts[1] : null;
//             }
//           };
//           const oldImageKey = extractKeyFromUrl(existingBooking.carImage);
//           if (oldImageKey) {
//             await deleteFromS3(oldImageKey).catch(console.error);
//           }
//         }
//         updateData.carImage = getS3Url(req.files.carImage[0].key);
//         console.log('🖼️ Car image updated:', updateData.carImage);
//       } else if (req.body.carImage !== undefined) {
//         // Handle car image URL from body (can be null to remove image)
//         if (isValidValue(req.body.carImage)) {
//           updateData.carImage = String(req.body.carImage).trim();
//         } else {
//           updateData.carImage = null; // Remove image
//         }
//       }

//       // Handle special request audio (optional)
//       if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio.length > 0) {
//         // Delete old audio from S3 if exists
//         if (existingBooking.specialRequestAudio && typeof existingBooking.specialRequestAudio === 'string') {
//           const extractKeyFromUrl = (url) => {
//             if (!url) return null;
//             try {
//               const urlObj = new URL(url);
//               return urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
//             } catch (error) {
//               const parts = url.split('.amazonaws.com/');
//               return parts.length > 1 ? parts[1] : null;
//             }
//           };
//           const oldAudioKey = extractKeyFromUrl(existingBooking.specialRequestAudio);
//           if (oldAudioKey) {
//             await deleteFromS3(oldAudioKey).catch(console.error);
//           }
//         }
//         updateData.specialRequestAudio = getS3Url(req.files.specialRequestAudio[0].key);
//         console.log('🎵 Audio file updated:', updateData.specialRequestAudio);
//       } else if (req.body.specialRequestAudio !== undefined) {
//         // Handle audio URL from body (can be null to remove)
//         if (isValidValue(req.body.specialRequestAudio)) {
//           updateData.specialRequestAudio = String(req.body.specialRequestAudio).trim();
//         } else {
//           updateData.specialRequestAudio = null; // Remove audio
//         }
//       }

//       // Add updated timestamp
//       updateData.updatedAt = new Date();

//       // If no fields to update
//       if (Object.keys(updateData).length === 0) {
//         if (req.files) {
//           if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//           if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'No valid fields provided for update'
//         });
//       }

//       console.log('📦 Final update data:', JSON.stringify(updateData, null, 2));

//       // Update the booking
//       const updatedBooking = await HourlyBooking.findByIdAndUpdate(
//         bookingId,
//         updateData,
//         { new: true, runValidators: true }
//       );

//       // Send notification
//       try {
//         let notificationMessage = `Your hourly booking for ${updatedBooking.carName} has been updated successfully.`;
//         let notificationType = 'booking_updated';

//         if (updateData.bookingStatus === 'cancelled') {
//           notificationMessage = `Your hourly booking for ${updatedBooking.carName} has been cancelled.`;
//           notificationType = 'booking_cancelled';
//         } else if (updateData.bookingStatus === 'confirmed') {
//           notificationMessage = `Your hourly booking for ${updatedBooking.carName} has been confirmed.`;
//           notificationType = 'booking_confirmed';
//         } else if (updateData.bookingStatus === 'starttracking') {
//           notificationMessage = `Your hourly booking for ${updatedBooking.carName} is now being tracked.`;
//           notificationType = 'booking_starttracking';
//         }

//         await notifyUser(
//           updatedBooking.customerID,
//           '📅 Booking Updated',
//           notificationMessage,
//           {
//             type: notificationType,
//             bookingId: updatedBooking._id.toString(),
//             status: updatedBooking.bookingStatus
//           }
//         );
//       } catch (notifyError) {
//         console.error('Notification error:', notifyError);
//       }

//       res.status(200).json({
//         success: true,
//         message: 'Booking updated successfully',
//         data: updatedBooking
//       });

//     } catch (error) {
//       console.error('❌ Update booking error:', error);

//       // Delete newly uploaded files if error occurs
//       if (req.files) {
//         if (req.files.carImage) {
//           await deleteFromS3(req.files.carImage[0].key).catch(console.error);
//         }
//         if (req.files.specialRequestAudio) {
//           await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
//         }
//       }

//       if (error.name === 'ValidationError') {
//         return res.status(400).json({
//           success: false,
//           message: 'Validation error',
//           errors: Object.keys(error.errors).reduce((acc, key) => {
//             acc[key] = error.errors[key].message;
//             return acc;
//           }, {})
//         });
//       }


//       if (error.name === 'CastError') {
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid booking ID format'
//         });
//       }

//       res.status(500).json({
//         success: false,
//         message: 'Error updating booking',
//         error: error.message
//       });
//     }
//   });


// READ - Get all hourly bookings with populated references and pagination
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      sort = '-createdAt',
      status,
      customerID,
      driverID,
      cityID,
      fromDate,
      toDate
    } = req.query;

    // Build query filters
    const query = {};
    
    if (status) query.bookingStatus = status;
    if (customerID && mongoose.Types.ObjectId.isValid(customerID)) {
      query.customerID = new mongoose.Types.ObjectId(customerID);
    }
    if (driverID && mongoose.Types.ObjectId.isValid(driverID)) {
      query.driverID = new mongoose.Types.ObjectId(driverID);
    }
    if (cityID && mongoose.Types.ObjectId.isValid(cityID)) {
      query.cityID = new mongoose.Types.ObjectId(cityID);
    }
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = new Date(fromDate);
      if (toDate) query.createdAt.$lte = new Date(toDate);
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const total = await HourlyBooking.countDocuments(query);

    // Get bookings with full population
    const bookings = await HourlyBooking.find(query)
      .populate({
        path: 'categoryID',
        model: 'Category',
        select: '_id name  description descriptionAr image isActive'
      })
      .populate({
        path: 'brandID',
        model: 'Brand',
        select: '_id brandName brandNameAr logo isActive'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          {
            path: 'categoryID',
            model: 'Category',
            select: '_id name nameAr'
          },
          {
            path: 'brandID',
            model: 'Brand',
            select: '_id brandName brandNameAr'
          }
        ],
        select: '_id categoryID brandID carName model numberOfPassengers carImage minimumChargeDistance hourlyRate isActive'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image isActive'
      })
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage fullPhoneNumber isActive'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating totalTrips isActive isVerified'
      })
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Format the response with full field mapping
    const formattedBookings = bookings.map(booking => ({
      _id: booking._id,
      
      // Basic Information
      bookingType: 'hourly',
      bookingNumber: booking.bookingNumber || `HB${booking._id.toString().slice(-8)}`,
      
      // Category Details
      category: booking.categoryID ? {
        _id: booking.categoryID._id,
        name: booking.categoryID.name,
        nameAr: booking.categoryID.nameAr,
        description: booking.categoryID.description,
        descriptionAr: booking.categoryID.descriptionAr,
        image: booking.categoryID.image,
        isActive: booking.categoryID.isActive
      } : null,
      
      // Brand Details
      brand: booking.brandID ? {
        _id: booking.brandID._id,
        brandName: booking.brandID.brandName,
        brandNameAr: booking.brandID.brandNameAr,
        logo: booking.brandID.logo,
        isActive: booking.brandID.isActive
      } : null,
      
      // Car Details with nested relations
      car: booking.carID ? {
        _id: booking.carID._id,
        carName: booking.carID.carName,
        model: booking.carID.model,
        numberOfPassengers: booking.carID.numberOfPassengers,
        carImage: booking.carID.carImage,
        minimumChargeDistance: booking.carID.minimumChargeDistance,
        hourlyRate: booking.carID.hourlyRate,
        category: booking.carID.categoryID ? {
          _id: booking.carID.categoryID._id,
          name: booking.carID.categoryID.name,
          nameAr: booking.carID.categoryID.nameAr
        } : null,
        brand: booking.carID.brandID ? {
          _id: booking.carID.brandID._id,
          brandName: booking.carID.brandID.brandName,
          brandNameAr: booking.carID.brandID.brandNameAr
        } : null,
        isActive: booking.carID.isActive
      } : null,
      
      // City Details
      city: booking.cityID ? {
        _id: booking.cityID._id,
        cityName: booking.cityID.cityName,
        cityNameAr: booking.cityID.cityNameAr,
        image: booking.cityID.image,
        isActive: booking.cityID.isActive
      } : null,
      
      // Customer Details
      customer: booking.customerID ? {
        _id: booking.customerID._id,
        username: booking.customerID.username,
        email: booking.customerID.email,
        phoneNumber: booking.customerID.phoneNumber,
        countryCode: booking.customerID.countryCode,
        fullPhoneNumber: booking.customerID.fullPhoneNumber || 
          `${booking.customerID.countryCode || ''}${booking.customerID.phoneNumber || ''}`,
        profileImage: booking.customerID.profileImage,
        isActive: booking.customerID.isActive
      } : null,
      
      // Driver Details
      driver: booking.driverID ? {
        _id: booking.driverID._id,
        driverName: booking.driverID.driverName,
        countryCode: booking.driverID.countryCode,
        phoneNumber: booking.driverID.phoneNumber,
        fullPhoneNumber: `${booking.driverID.countryCode || ''}${booking.driverID.phoneNumber || ''}`,
        licenseNumber: booking.driverID.licenseNumber,
        profileImage: booking.driverID.profileImage,
        rating: booking.driverID.rating,
        totalTrips: booking.driverID.totalTrips,
        isActive: booking.driverID.isActive,
        isVerified: booking.driverID.isVerified
      } : null,
      
      // Hourly Booking Specific Fields
      hours: booking.hours,
      startTime: booking.startTime,
      endTime: booking.endTime,
      totalCharge: booking.totalCharge,
      hourlyRate: booking.hourlyRate,
      
      // Location Details
      pickupLat: booking.pickupLat,
      pickupLong: booking.pickupLong,
      pickupAddress: booking.pickupAddress,
      dropOffLat: booking.dropOffLat,
      dropOffLong: booking.dropOffLong,
      dropOffAddress: booking.dropOffAddress,
      
      // Car Details from Booking
      carModel: booking.carModel,
      carImage: booking.carImage,
      
      // Passenger Details
      passengerCount: booking.passengerCount,
      passengerNames: booking.passengerNames,
      passengerMobile: booking.passengerMobile,
      
      // Status and Tracking
      bookingStatus: booking.bookingStatus,
      trackingTimeline: booking.trackingTimeline || [],
      paymentStatus: booking.paymentStatus,
      paymentMethod: booking.paymentMethod,
      
      // Ratings
      customerRating: booking.customerRating,
      driverRating: booking.driverRating,
      customerReview: booking.customerReview,
      driverReview: booking.driverReview,
      
      // Special Requests
      specialRequests: booking.specialRequests,
      specialRequestAudio: booking.specialRequestAudio,
      
      // Transaction Details
      transactionID: booking.transactionID,
      orderID: booking.orderID,
      discountApplied: booking.discountApplied,
      discountAmount: booking.discountAmount,
      taxAmount: booking.taxAmount,
      
      // Timestamps
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      startedAt: booking.startedAt,
      completedAt: booking.completedAt,
      cancelledAt: booking.cancelledAt,
      
      // Additional Metadata
      metadata: booking.metadata
    }));

    // Calculate pagination info
    const totalPages = Math.ceil(total / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.status(200).json({
      success: true,
      message: 'Hourly bookings fetched successfully',
      count: formattedBookings.length,
      total: total,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        itemsPerPage: limitNum,
        totalItems: total,
        hasNextPage: hasNextPage,
        hasPrevPage: hasPrevPage,
        nextPage: hasNextPage ? pageNum + 1 : null,
        prevPage: hasPrevPage ? pageNum - 1 : null
      },
      data: formattedBookings
    });

  } catch (error) {
    console.error('Get hourly bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching hourly bookings',
      error: error.message
    });
  }
});



// READ - Get single booking by ID with populated references and Arabic mapping
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'صيغة معرف الحجز غير صالحة',
        message_en: 'Invalid booking ID format'
      });
    }
    
    const booking = await HourlyBooking.findById(id)
      .populate({
        path: 'categoryID',
        model: 'Category',
        select: '_id name nameAr description descriptionAr image'
      })
      .populate({
        path: 'brandID',
        model: 'Brand',
        select: '_id brandName brandNameAr logo'
      })
      .populate({
        path: 'carID',
        model: 'Car',
        populate: [
          {
            path: 'categoryID',
            model: 'Category',
            select: '_id name nameAr'
          },
          {
            path: 'brandID',
            model: 'Brand',
            select: '_id brandName brandNameAr'
          }
        ],
        select: '_id categoryID brandID carName model numberOfPassengers carImage hourlyRate'
      })
      .populate({
        path: 'cityID',
        model: 'City',
        select: '_id cityName cityNameAr image'
      })
      .populate({
        path: 'customerID',
        model: 'User',
        select: '_id username email phoneNumber countryCode profileImage'
      })
      .populate({
        path: 'driverID',
        model: 'Driver',
        select: '_id driverName countryCode phoneNumber licenseNumber profileImage rating'
      })
      .lean();
      
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'الحجز غير موجود',
        message_en: 'Booking not found'
      });
    }
    
    // Format response with Arabic mapping
    const formattedBooking = {
      success: true,
      message: 'تم جلب بيانات الحجز بنجاح',
      message_en: 'Booking fetched successfully',
      data: {
        _id: booking._id,
        
        // Basic Info
        bookingType: 'بالساعة',
        bookingType_en: 'hourly',
        
        // Category with Arabic names
        category: booking.categoryID ? {
          _id: booking.categoryID._id,
          name: booking.categoryID.name,
          nameAr: booking.categoryID.nameAr,
          name_en: booking.categoryID.name,
          description: booking.categoryID.description,
          descriptionAr: booking.categoryID.descriptionAr,
          image: booking.categoryID.image
        } : null,
        
        // Brand with Arabic names
        brand: booking.brandID ? {
          _id: booking.brandID._id,
          name: booking.brandID.brandName,
          nameAr: booking.brandID.brandNameAr,
          name_en: booking.brandID.brandName,
          logo: booking.brandID.logo
        } : null,
        
        // Car with full details
        car: booking.carID ? {
          _id: booking.carID._id,
          name: booking.carID.carName,
          nameAr: booking.carID.carName, // You might want to add carNameAr to schema
          model: booking.carID.model,
          passengers: booking.carID.numberOfPassengers,
          image: booking.carID.carImage,
          hourlyRate: booking.carID.hourlyRate,
          category: booking.carID.categoryID ? {
            _id: booking.carID.categoryID._id,
            name: booking.carID.categoryID.name,
            nameAr: booking.carID.categoryID.nameAr
          } : null,
          brand: booking.carID.brandID ? {
            _id: booking.carID.brandID._id,
            name: booking.carID.brandID.brandName,
            nameAr: booking.carID.brandID.brandNameAr
          } : null
        } : null,
        
        // City with Arabic name
        city: booking.cityID ? {
          _id: booking.cityID._id,
          name: booking.cityID.cityName,
          nameAr: booking.cityID.cityNameAr,
          name_en: booking.cityID.cityName,
          image: booking.cityID.image
        } : null,
        
        // Customer details
        customer: booking.customerID ? {
          _id: booking.customerID._id,
          name: booking.customerID.username,
          email: booking.customerID.email,
          phone: booking.customerID.phoneNumber,
          countryCode: booking.customerID.countryCode,
          fullPhone: `${booking.customerID.countryCode || ''}${booking.customerID.phoneNumber || ''}`,
          profileImage: booking.customerID.profileImage
        } : null,
        
        // Driver details
        driver: booking.driverID ? {
          _id: booking.driverID._id,
          name: booking.driverID.driverName,
          nameAr: booking.driverID.driverName,
          phone: booking.driverID.phoneNumber,
          countryCode: booking.driverID.countryCode,
          fullPhone: `${booking.driverID.countryCode || ''}${booking.driverID.phoneNumber || ''}`,
          licenseNumber: booking.driverID.licenseNumber,
          profileImage: booking.driverID.profileImage,
          rating: booking.driverID.rating
        } : null,
        
        // Booking Details
        hours: booking.hours,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalCharge: booking.totalCharge,
        
        // Location Details
        pickup: {
          lat: booking.pickupLat,
          lng: booking.pickupLong,
          address: booking.pickupAddress,
          addressAr: booking.pickupAddress, // Add translation if available
        },
        dropoff: {
          lat: booking.dropOffLat,
          lng: booking.dropOffLong,
          address: booking.dropOffAddress,
          addressAr: booking.dropOffAddress, // Add translation if available
        },
        
        // Passenger Details
        passengers: {
          count: booking.passengerCount,
          names: booking.passengerNames,
          mobile: booking.passengerMobile
        },
        
        // Status
        status: {
          code: booking.bookingStatus,
          label_en: booking.bookingStatus,
          payment: booking.paymentStatus ? 'مدفوع' : 'غير مدفوع',
          payment_en: booking.paymentStatus ? 'paid' : 'unpaid'
        },
        
        // Timeline
        timeline: booking.trackingTimeline || [],
        
        // Special Requests
        specialRequests: {
          text: booking.specialRequests,
          audio: booking.specialRequestAudio
        },
        
        // Transaction
        transaction: {
          id: booking.transactionID,
          orderId: booking.orderID,
          discount: booking.discountApplied,
          discountAmount: booking.discountAmount,
          tax: booking.taxAmount
        },
        
        // Ratings
        ratings: {
          customer: booking.customerRating,
          driver: booking.driverRating,
          customerReview: booking.customerReview,
          driverReview: booking.driverReview
        },
        
        // Timestamps
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        startedAt: booking.startedAt,
        completedAt: booking.completedAt,
        
        // Metadata
        metadata: booking.metadata
      }
    };

    
    res.status(200).json(formattedBooking);
    
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب بيانات الحجز',
      message_en: 'Error fetching booking',
      error: error.message
    });
  }
});


// READ - Get bookings by customer ID
router.get('/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format'
      });
    }
    
    // Check if customer exists
    const customerExists = await User.findById(customerId);
    if (!customerExists) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    const bookings = await HourlyBooking.find({ customerID: customerId })
      .populate('categoryID', 'name description')
      .populate('brandID', 'brandName logo')
      .populate('carID', 'name model year licensePlate')
      .populate('cityID', 'cityName cityNameAr country')
      .populate('driverID', 'name email phone licenseNumber')
      .sort({ createdAt: -1 });


    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// READ - Get bookings by driver ID
router.get('/driver/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format'
      });
    }
    
    // Check if driver exists
    const driverExists = await Driver.findById(driverId);
    if (!driverExists) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }
    
    
    const bookings = await HourlyBooking.find({ driverID: driverId })
      .populate('categoryID', 'name description')
      .populate('brandID', 'brandName logo')
      .populate('carID', 'name model year licensePlate')
      .populate('cityID', 'cityName cityNameAr country')
      .populate('driverID', 'name email phone licenseNumber')
      // .populate('customerID', 'name email phone')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


// READ - Get bookings by status
router.get('/status/:status', async (req, res) => {
  try {
    const { status } = req.params;
  const validStatuses = ['pending', 'assigned', 'starttrack','stoptrack', 'completed',
        'paymentPending', 'reviewed', 'cancelled'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: pending, assigned, started, stopped, completed, paymentPending, reviewed, cancelled'
      });
    }
    
    const bookings = await HourlyBooking.find({ bookingStatus: status })
      .populate('categoryID', 'name description')
      .populate('brandID', 'name logo')
      .populate('carID', 'name model year licensePlate')
      .populate('cityID', 'name country')
      .populate('customerID', 'name email phone')
      .populate('driverID', 'name email phone licenseNumber')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});



// UPDATE - Update booking status only
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { bookingStatus } = req.body;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }


    
    // Validate status
  const validStatuses = ['pending', 'assigned', 'starttrack','stoptrack', 'completed',
        'paymentPending', 'reviewed', 'cancelled'];
    if (!bookingStatus || !validStatuses.includes(bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking status. Must be one of: pending, assigned, started, stopped, completed, paymentPending, reviewed, cancelled'
      });
    }

    
    // Check if booking exists
    const existingBooking = await HourlyBooking.findById(id);
    if (!existingBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    const updatedBooking = await HourlyBooking.findByIdAndUpdate(
      id,
      { 
        bookingStatus,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    ).populate('categoryID', 'name description')
     .populate('brandID', 'name logo')
     .populate('carID', 'name model year licensePlate')
     .populate('cityID', 'name country')
     .populate('customerID', 'name email phone')
     .populate('driverID', 'name email phone licenseNumber');

    // Send notification
    try {
      let statusMessage = '';
      switch (bookingStatus) {
        case 'confirmed':
          statusMessage = 'Your booking has been confirmed!';
          break;
        case 'in-progress':
          statusMessage = 'Your ride has started!';
          break;
        case 'completed':
          statusMessage = 'Your ride is complete. Thank you for booking with us!';
          break;
        case 'cancelled':
          statusMessage = 'Your booking has been cancelled.';
          break;
        default:
          statusMessage = `Your booking status has been updated to ${bookingStatus}`;
      }
      
      await notifyUser(
        updatedBooking.customerID,
        '📅 Booking Updated',
        statusMessage,
        {
          type: 'booking_updated',
          bookingId: updatedBooking._id.toString(),
          oldStatus: existingBooking.bookingStatus,
          newStatus: bookingStatus
        }
      );
    } catch (notifyError) {
      console.error('Notification error:', notifyError);
    }

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      data: updatedBooking
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

// UPDATE - Toggle isActive status
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }
    
    const booking = await HourlyBooking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    booking.isActive = !booking.isActive;
    booking.updatedAt = new Date();
    await booking.save();

    res.status(200).json({
      success: true,
      message: `Booking ${booking.isActive ? 'activated' : 'deactivated'} successfully`,
      data: booking
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});




// DELETE /api/hourly-bookings/:id - Delete booking and associated files from S3
router.delete('/:id',
  // Optional: Only allow admins to delete bookings
  async (req, res) => {
    try {

      const bookingId = req.params.id;

      console.log('🔴 DELETE request received for ID:', bookingId);
      console.log('User:', req.user?.adminId || req.user?.id || 'Unknown');

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Find the booking first to get file references
      const booking = await HourlyBooking.findById(bookingId);

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
   
      }

      console.log('📦 Booking found:', {
        id: booking._id,
        carImage: booking.carImage ? 'Present' : 'None',
        specialRequestAudio: booking.specialRequestAudio ? 'Present' : 'None',
        status: booking.bookingStatus
      });

      

      // ========== DELETE FILES FROM S3 ==========
      const deletionResults = {
        carImage: { deleted: false, key: null, error: null },
        audio: { deleted: false, key: null, error: null }
      };

      // Helper function to extract S3 key from URL
      const extractKeyFromUrl = (url) => {
        if (!url) return null;
        try {
          // Method 1: Parse URL object
          try {
            const urlObj = new URL(url);
            // Remove leading slash if present
            return urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
          } catch (urlError) {
            // Method 2: Simple string split as fallback
            const parts = url.split('.amazonaws.com/');
            return parts.length > 1 ? parts[1] : null;
          }
        } catch (error) {
          console.error('Error extracting key from URL:', error);
          return null;
        }
      };

      // Delete car image from S3 if exists
      if (booking.carImage) {
        const imageKey = extractKeyFromUrl(booking.carImage);
        if (imageKey) {
          deletionResults.carImage.key = imageKey;
          try {
            await deleteFromS3(imageKey);
            deletionResults.carImage.deleted = true;
            console.log('✅ Car image deleted from S3:', imageKey);
          } catch (s3Error) {
            deletionResults.carImage.error = s3Error.message;
            console.error('❌ Failed to delete car image from S3:', s3Error);
          }
        } else {
          console.log('⚠️ Could not extract key from carImage URL:', booking.carImage);
        }
      }

      // Delete audio file from S3 if exists
      if (booking.specialRequestAudio) {
        const audioKey = extractKeyFromUrl(booking.specialRequestAudio);
        if (audioKey) {
          deletionResults.audio.key = audioKey;
          try {
            await deleteFromS3(audioKey);
            deletionResults.audio.deleted = true;
            console.log('✅ Audio file deleted from S3:', audioKey);
          } catch (s3Error) {
            deletionResults.audio.error = s3Error.message;
            console.error('❌ Failed to delete audio file from S3:', s3Error);
          }
        } else {
          console.log('⚠️ Could not extract key from audio URL:', booking.specialRequestAudio);
        }
      }

      // ========== DELETE BOOKING FROM DATABASE ==========
      await HourlyBooking.findByIdAndDelete(bookingId);
      console.log('✅ Booking deleted from database:', bookingId);

      // ========== CLEANUP RELATED DATA ==========
      // Optional: Delete any related assignments
      try {
        if (mongoose.modelNames().includes('AdminAssignDriver')) {
          const AdminAssignDriver = mongoose.model('AdminAssignDriver');
          const deleteResult = await AdminAssignDriver.deleteMany({ bookingID: bookingId });
          console.log(`✅ Deleted ${deleteResult.deletedCount} related assignments`);
        }
      } catch (assignError) {
        console.error('⚠️ Error deleting related assignments:', assignError);
        // Don't fail the request if this fails
      }

      // Send notification about deletion (optional)
      try {
        if (typeof notifyUser === 'function' && booking.customerID) {
          await notifyUser(
            booking.customerID,
            '📅 Booking Cancelled',
            `Your hourly booking for ${booking.carName || 'your vehicle'} has been cancelled.`,
            {
              type: 'booking_cancelled',
              bookingId: booking._id.toString()
            }
          );
        }
      } catch (notifyError) {
        console.error('Notification error:', notifyError);
      }

      // Prepare response message
      const s3Status = [];
      if (deletionResults.carImage.deleted) s3Status.push('car image');
      if (deletionResults.audio.deleted) s3Status.push('audio file');

      const s3Message = s3Status.length > 0
        ? ` and associated ${s3Status.join(' & ')} deleted from storage`
        : '';

      // Check if any S3 deletions failed
      const hasErrors = deletionResults.carImage.error || deletionResults.audio.error;

      res.status(200).json({
        success: true,
        message: `Booking deleted successfully${s3Message}`,
        data: {
          deletedBookingId: booking._id,
          deletedCar: booking.carName,
          s3Cleanup: {
            carImage: {
              deleted: deletionResults.carImage.deleted,
              key: deletionResults.carImage.key,
              ...(deletionResults.carImage.error && { error: deletionResults.carImage.error })
            },
            audio: {
              deleted: deletionResults.audio.deleted,
              key: deletionResults.audio.key,
              ...(deletionResults.audio.error && { error: deletionResults.audio.error })
            }
          },
          bookingDetails: {
            customerID: booking.customerID,
            driverID: booking.driverID,
            status: booking.bookingStatus,
            hours: booking.hours,
            carName: booking.carName
          }
        },
        ...(hasErrors && { warning: 'Some files could not be deleted from storage, manual cleanup may be required' })
      });

    } catch (error) {
      console.error('❌ Delete booking error:', error);

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



module.exports = router;