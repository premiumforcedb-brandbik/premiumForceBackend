const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const HourlyBooking = require('../models/hourlyBookingModel');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const NotificationService = require('../services/notificationService');

const {authenticateDriver} = require('../middleware/driverware');
// // Helper function for notifications (implement as needed)
// const notifyUser = async (userId, title, body, data) => {
//   console.log(`Notification to ${userId}:`, { title, body, data });
//   // Implement your notification logic here
//   return true;
// };

const { notifyUser } = require('../fcm');

 const {authenticateCustomer
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

      // Helper function to check if value is valid (not empty, not null, not undefined)
      const isValidValue = (value) => {
        return value !== undefined && 
               value !== null && 
               value !== '' && 
               value !== 'null' && 
               value !== 'undefined';
      };

      const {
        hours, pickupLat, pickuplong, pickupAdddress,
        extraHours, category, model, brand, carName,
        charge, customerID, driverID, passsenrgersCount,
        passengerMobile, carClass, specialRequestText,
        bookingStatus, passengerNames, isActive,
        transactionID, orderID, discountPercentage
      } = req.body;

      // ========== IMPROVED VALIDATION ==========
      // Required fields (carImage is now optional)
      const requiredFields = {
        hours: hours,
        pickupLat: pickupLat,
        pickuplong: pickuplong,
        pickupAdddress: pickupAdddress,
        category: category,
        model: model,
        brand: brand,
        carName: carName,
        charge: charge,
        customerID: customerID,
        passsenrgersCount: passsenrgersCount,
        passengerMobile: passengerMobile,
        carClass: carClass
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
          received: Object.keys(req.body),
          note: 'carImage is optional'
        });
      }

      // ========== EXISTING BOOKING CHECK ==========
      // Check if customer already has an active booking
      const activeBooking = await HourlyBooking.findOne({
        customerID: String(customerID).trim(),
        bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
        isActive: true
      });

      if (activeBooking) {
        // Delete uploaded files if customer has active booking
        if (req.files) {
          if (req.files.carImage) {
            await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          }
          if (req.files.specialRequestAudio) {
            await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
        }

        // Send notification
        try {
          await notifyUser(
            String(customerID).trim(),
            '📅 Booking Already Exists',
            `You already have an active booking for ${activeBooking.carName}. Please complete or cancel it before creating a new one.`,
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
            existingCar: activeBooking.carName,
            message: 'Please complete or cancel your existing booking before creating a new one'
          }
        });
      }

      // Parse passengerNames
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

      // Handle car image (OPTIONAL - can be from file upload or URL)
      let carImageUrl = null;
      
      // Check for uploaded file
      if (req.files && req.files.carImage && req.files.carImage.length > 0) {
        carImageUrl = getS3Url(req.files.carImage[0].key);
        console.log('Using uploaded car image:', carImageUrl);
      } 
      // Check for image URL in body
      else if (req.body.carImage && isValidValue(req.body.carImage)) {
        carImageUrl = String(req.body.carImage).trim();
        console.log('Using car image URL from body:', carImageUrl);
      }
      // If no image provided, it will remain null (optional)

      // Handle audio (optional)
      let audioUrl = null;
      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio.length > 0) {
        audioUrl = getS3Url(req.files.specialRequestAudio[0].key);
        console.log('Using uploaded audio:', audioUrl);
      } else if (req.body.specialRequestAudio && isValidValue(req.body.specialRequestAudio)) {
        audioUrl = String(req.body.specialRequestAudio).trim();
        console.log('Using audio URL from body:', audioUrl);
      }

      // Parse numeric values
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

      // Create booking object
      const bookingData = {
        hours: parsedHours,
        pickupLat: parsedPickupLat,
        pickuplong: parsedPickuplong,
        pickupAdddress: String(pickupAdddress).trim(),
        category: String(category).trim(),
        model: String(model).trim(),
        brand: String(brand).trim(),
        carName: String(carName).trim(),
        charge: parsedCharge,
        customerID: String(customerID).trim(),
        passsenrgersCount: parsedPassengersCount,
        passengerMobile: String(passengerMobile).trim(),
        carClass: String(carClass).trim(),
        extraHours: parsedExtraHours,
        bookingStatus: bookingStatus && isValidValue(bookingStatus) ? String(bookingStatus).trim().toLowerCase() : 'pending',
        isActive: isActive === 'true' || isActive === true,
        passengerNames: parsedPassengerNames,
        specialRequestText: specialRequestText && isValidValue(specialRequestText) ? String(specialRequestText).trim() : '',
        discountPercentage: parsedDiscountPercentage
      };

      // Add optional fields only if they exist
      if (carImageUrl) {
        bookingData.carImage = carImageUrl;
      }

      if (audioUrl) {
        bookingData.specialRequestAudio = audioUrl;
      }

      // Handle driverID (optional)
      if (driverID && isValidValue(driverID) && driverID !== 'null' && driverID !== 'undefined') {
        if (mongoose.Types.ObjectId.isValid(driverID)) {
          bookingData.driverID = driverID;
        }
      }

      // Handle transaction and order IDs
      if (transactionID && isValidValue(transactionID)) {
        bookingData.transactionID = String(transactionID).trim();
      }
      if (orderID && isValidValue(orderID)) {
        bookingData.orderID = String(orderID).trim();
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
          `Your hourly booking for ${savedBooking.carName} has been created successfully.`,
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
    console.log('🔵 PUT request received for ID:', req.params.id);
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
      const bookingId = req.params.id;
      
      console.log('📦 Update booking ID:', bookingId);
      console.log('📁 Files received:', req.files ? Object.keys(req.files) : 'No files');
      console.log('📝 Body received:', req.body);

      // Helper function to check if value is valid
      const isValidValue = (value) => {
        return value !== undefined && 
               value !== null && 
               value !== '' && 
               value !== 'null' && 
               value !== 'undefined';
      };

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
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
          message: 'Invalid booking ID format'
        });
      }

      // Find existing booking
      const existingBooking = await HourlyBooking.findById(bookingId);
      
      if (!existingBooking) {
        // Delete uploaded files if booking not found
        if (req.files) {
          if (req.files.carImage) {
            await deleteFromS3(req.files.carImage[0].key).catch(console.error);
          }
          if (req.files.specialRequestAudio) {
            await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
        }
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      console.log('Existing booking:', {
        id: existingBooking._id,
        status: existingBooking.bookingStatus,
        customerID: existingBooking.customerID
      });

      // ========== EXISTING BOOKING CHECK FOR UPDATE ==========
      // Check if trying to update a completed booking
      if (existingBooking.bookingStatus === 'completed') {
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
          message: 'Cannot update a completed booking',
          currentStatus: existingBooking.bookingStatus
        });
      }

      // Extract fields from request body
      const {
        hours, pickupLat, pickuplong, pickupAdddress,
        extraHours, category, model, brand, carName,
        charge, customerID, driverID, passsenrgersCount,
        passengerMobile, carClass, specialRequestText,
        bookingStatus, passengerNames, isActive,
        transactionID, orderID, discountPercentage
      } = req.body;

      // Build update object
      const updateData = {};

      // ========== VALIDATE AND UPDATE FIELDS ==========

      // Numeric fields
      if (isValidValue(hours)) {
        const parsedHours = parseInt(hours);
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
        updateData.hours = parsedHours;
      }

      if (isValidValue(pickupLat)) {
        const parsedPickupLat = parseFloat(pickupLat);
        if (isNaN(parsedPickupLat)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid pickup latitude value'
          });
        }
        updateData.pickupLat = parsedPickupLat;
      }

      if (isValidValue(pickuplong)) {
        const parsedPickuplong = parseFloat(pickuplong);
        if (isNaN(parsedPickuplong)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid pickup longitude value'
          });
        }
        updateData.pickuplong = parsedPickuplong;
      }

      if (isValidValue(charge)) {
        const parsedCharge = parseFloat(charge);
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
        updateData.charge = parsedCharge;
      }

      if (isValidValue(passsenrgersCount)) {
        const parsedPassengersCount = parseInt(passsenrgersCount);
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
        updateData.passsenrgersCount = parsedPassengersCount;
      }

      if (isValidValue(extraHours)) {
        updateData.extraHours = parseInt(extraHours);
      }

      if (isValidValue(discountPercentage)) {
        updateData.discountPercentage = parseFloat(discountPercentage);
      }

      // String fields
      if (isValidValue(pickupAdddress)) updateData.pickupAdddress = String(pickupAdddress).trim();
      if (isValidValue(category)) updateData.category = String(category).trim();
      if (isValidValue(model)) updateData.model = String(model).trim();
      if (isValidValue(brand)) updateData.brand = String(brand).trim();
      if (isValidValue(carName)) updateData.carName = String(carName).trim();
      if (isValidValue(passengerMobile)) updateData.passengerMobile = String(passengerMobile).trim();
      if (isValidValue(carClass)) updateData.carClass = String(carClass).trim();
      if (isValidValue(transactionID)) updateData.transactionID = String(transactionID).trim();
      if (isValidValue(orderID)) updateData.orderID = String(orderID).trim();

      // Special request text (can be empty)
      if (specialRequestText !== undefined) {
        updateData.specialRequestText = isValidValue(specialRequestText) ? String(specialRequestText).trim() : '';
      }

      // Boolean
      if (isActive !== undefined) {
        updateData.isActive = isActive === 'true' || isActive === true;
      }

      // Handle customerID - Check if changing
      if (isValidValue(customerID) && customerID !== existingBooking.customerID) {
        // Check if new customer has active booking
        const customerActiveBooking = await HourlyBooking.findOne({
          _id: { $ne: bookingId },
          customerID: String(customerID).trim(),
          bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
          isActive: true
        });

        if (customerActiveBooking) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(409).json({
            success: false,
            message: 'New customer already has an active booking',
            data: {
              existingBookingId: customerActiveBooking._id,
              existingStatus: customerActiveBooking.bookingStatus
            }
          });
        }
        updateData.customerID = String(customerID).trim();
      }

      // Handle driverID (optional)
      if (driverID !== undefined) {
        if (!isValidValue(driverID) || driverID === 'null' || driverID === 'undefined') {
          updateData.driverID = null;
        } else if (mongoose.Types.ObjectId.isValid(driverID)) {
          // Check if driver is already assigned to another active booking
          const driverActiveBooking = await HourlyBooking.findOne({
            _id: { $ne: bookingId },
            driverID: driverID,
            bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
            isActive: true
          });

          if (driverActiveBooking) {
            if (req.files) {
              if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
              if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
            }
            return res.status(409).json({
              success: false,
              message: 'Driver already assigned to another active booking',
              data: {
                existingBookingId: driverActiveBooking._id,
                existingStatus: driverActiveBooking.bookingStatus
              }
            });
          }
          updateData.driverID = driverID;
        }
      }

      // Handle bookingStatus
      if (isValidValue(bookingStatus)) {
        const newStatus = String(bookingStatus).trim().toLowerCase();
        const validStatuses = ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'];
        
        if (!validStatuses.includes(newStatus)) {
          if (req.files) {
            if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
            if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
          }
          return res.status(400).json({
            success: false,
            message: `Invalid status value: "${bookingStatus}"`,
            validStatuses: validStatuses
          });
        }

        // Define valid transitions
        const validTransitions = {
          'pending': ['confirmed', 'cancelled'],
          'confirmed': ['in-progress', 'cancelled'],
          'in-progress': ['completed'],
          'completed': [],
          'cancelled': []
        };

        // Check if transition is valid
        if (newStatus !== existingBooking.bookingStatus) {
          if (validTransitions[existingBooking.bookingStatus]?.includes(newStatus)) {
            updateData.bookingStatus = newStatus;
          } else {
            if (req.files) {
              if (req.files.carImage) await deleteFromS3(req.files.carImage[0].key).catch(console.error);
              if (req.files.specialRequestAudio) await deleteFromS3(req.files.specialRequestAudio[0].key).catch(console.error);
            }
            return res.status(400).json({
              success: false,
              message: `Invalid status transition from "${existingBooking.bookingStatus}" to "${bookingStatus}"`,
              allowedTransitions: validTransitions[existingBooking.bookingStatus] || []
            });
          }
        }
      }

      // Handle passengerNames
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

      // Handle car image (OPTIONAL - can be from file upload or URL)
      if (req.files && req.files.carImage && req.files.carImage.length > 0) {
        // Delete old image from S3 if exists
        if (existingBooking.carImage && typeof existingBooking.carImage === 'string') {
          const extractKeyFromUrl = (url) => {
            if (!url) return null;
            try {
              const urlObj = new URL(url);
              return urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
            } catch (error) {
              const parts = url.split('.amazonaws.com/');
              return parts.length > 1 ? parts[1] : null;
            }
          };
          const oldImageKey = extractKeyFromUrl(existingBooking.carImage);
          if (oldImageKey) {
            await deleteFromS3(oldImageKey).catch(console.error);
          }
        }
        updateData.carImage = getS3Url(req.files.carImage[0].key);
        console.log('🖼️ Car image updated:', updateData.carImage);
      } else if (req.body.carImage !== undefined) {
        // Handle car image URL from body (can be null to remove image)
        if (isValidValue(req.body.carImage)) {
          updateData.carImage = String(req.body.carImage).trim();
        } else {
          updateData.carImage = null; // Remove image
        }
      }

      // Handle special request audio (optional)
      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio.length > 0) {
        // Delete old audio from S3 if exists
        if (existingBooking.specialRequestAudio && typeof existingBooking.specialRequestAudio === 'string') {
          const extractKeyFromUrl = (url) => {
            if (!url) return null;
            try {
              const urlObj = new URL(url);
              return urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
            } catch (error) {
              const parts = url.split('.amazonaws.com/');
              return parts.length > 1 ? parts[1] : null;
            }
          };
          const oldAudioKey = extractKeyFromUrl(existingBooking.specialRequestAudio);
          if (oldAudioKey) {
            await deleteFromS3(oldAudioKey).catch(console.error);
          }
        }
        updateData.specialRequestAudio = getS3Url(req.files.specialRequestAudio[0].key);
        console.log('🎵 Audio file updated:', updateData.specialRequestAudio);
      } else if (req.body.specialRequestAudio !== undefined) {
        // Handle audio URL from body (can be null to remove)
        if (isValidValue(req.body.specialRequestAudio)) {
          updateData.specialRequestAudio = String(req.body.specialRequestAudio).trim();
        } else {
          updateData.specialRequestAudio = null; // Remove audio
        }
      }

      // Add updated timestamp
      updateData.updatedAt = new Date();

      // If no fields to update
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

      console.log('📦 Final update data:', JSON.stringify(updateData, null, 2));

      // Update the booking
      const updatedBooking = await HourlyBooking.findByIdAndUpdate(
        bookingId,
        updateData,
        { new: true, runValidators: true }
      );

      // Send notification
      try {
        let notificationMessage = `Your hourly booking for ${updatedBooking.carName} has been updated successfully.`;
        let notificationType = 'booking_updated';
        
        if (updateData.bookingStatus === 'cancelled') {
          notificationMessage = `Your hourly booking for ${updatedBooking.carName} has been cancelled.`;
          notificationType = 'booking_cancelled';
        } else if (updateData.bookingStatus === 'confirmed') {
          notificationMessage = `Your hourly booking for ${updatedBooking.carName} has been confirmed.`;
          notificationType = 'booking_confirmed';
        } else if (updateData.bookingStatus === 'in-progress') {
          notificationMessage = `Your hourly booking for ${updatedBooking.carName} is now in progress.`;
          notificationType = 'booking_in_progress';
        }
        
        await notifyUser(
          updatedBooking.customerID,
          '📅 Booking Updated',
          notificationMessage,
          {
            type: notificationType,
            bookingId: updatedBooking._id.toString(),
            status: updatedBooking.bookingStatus
          }
        );
      } catch (notifyError) {
        console.error('Notification error:', notifyError);
      }

      res.status(200).json({
        success: true,
        message: 'Booking updated successfully',
        data: updatedBooking
      });
      
    } catch (error) {
      console.error('❌ Update booking error:', error);
      
      // Delete newly uploaded files if error occurs
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

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating booking',
        error: error.message
      });
    }
});



// ============= GET HOURLY BOOKINGS BY CUSTOMER ID =============
// GET /api/hourly-bookings/customer/:customerId
// @desc    Get all bookings for a specific customer
router.get('/customer/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        const { 
            status, 
            startDate, 
            endDate,
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Validate customer ID
        if (!customerId || customerId === 'null' || customerId === 'undefined') {
            return res.status(400).json({
                success: false,
                message: 'Customer ID is required'
            });
        }

        // Build query
        const query = {
            customerID: String(customerId).trim()
        };

        // Filter by status if provided
        if (status) {
            const validStatuses = ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'];
            const cleanStatus = status.toLowerCase().trim();
            if (validStatuses.includes(cleanStatus)) {
                query.bookingStatus = cleanStatus;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status value',
                    validStatuses: validStatuses
                });
            }
        }

        // Date range filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.createdAt.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        // Pagination
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        // Sort
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Get bookings
        const bookings = await HourlyBooking.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limitNum);

        // Get total count
        const total = await HourlyBooking.countDocuments(query);

        // Calculate summary statistics
        const summary = {
            total: total,
            pending: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'pending' }),
            confirmed: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'confirmed' }),
            inProgress: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'in-progress' }),
            completed: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'completed' }),
            cancelled: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'cancelled' }),
            active: await HourlyBooking.countDocuments({ 
                ...query, 
                bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
                isActive: true 
            })
        };

        // Calculate total spending (for completed bookings)
        const completedBookings = await HourlyBooking.find({ 
            ...query, 
            bookingStatus: 'completed' 
        }).select('charge hours');
        
        const totalSpent = completedBookings.reduce((sum, booking) => {
            return sum + (booking.charge * booking.hours);
        }, 0);

        res.status(200).json({
            success: true,
            message: 'Customer bookings fetched successfully',
            data: bookings,
            summary: {
                ...summary,
                totalSpent: totalSpent
            },
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
        console.error('Get customer bookings error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching customer bookings',
            error: error.message
        });
    }
});

// ============= GET HOURLY BOOKINGS BY DRIVER ID =============
// GET /api/hourly-bookings/driver/:driverId
// @desc    Get all bookings for a specific driver
router.get('/driver/:driverId', async (req, res) => {
    try {
        const { driverId } = req.params;
        const { 
            status, 
            startDate, 
            endDate,
            page = 1,
            limit = 10,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Validate driver ID
        if (!driverId || driverId === 'null' || driverId === 'undefined') {
            return res.status(400).json({
                success: false,
                message: 'Driver ID is required'
            });
        }

        // Build query
        const query = {
            driverID: String(driverId).trim()
        };

        // Filter by status if provided
        if (status) {
            const validStatuses = ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'];
            const cleanStatus = status.toLowerCase().trim();
            if (validStatuses.includes(cleanStatus)) {
                query.bookingStatus = cleanStatus;
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status value',
                    validStatuses: validStatuses
                });
            }
        }

        // Date range filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                query.createdAt.$gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        // Pagination
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 10;
        const skip = (pageNum - 1) * limitNum;

        // Sort
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        // Get bookings
        const bookings = await HourlyBooking.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limitNum);

        // Get total count
        const total = await HourlyBooking.countDocuments(query);

        // Calculate summary statistics
        const summary = {
            total: total,
            pending: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'pending' }),
            confirmed: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'confirmed' }),
            inProgress: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'in-progress' }),
            completed: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'completed' }),
            cancelled: await HourlyBooking.countDocuments({ ...query, bookingStatus: 'cancelled' }),
            active: await HourlyBooking.countDocuments({ 
                ...query, 
                bookingStatus: { $in: ['confirmed', 'in-progress'] },
                isActive: true 
            })
        };

        // Calculate total earnings (for completed bookings)
        const completedBookings = await HourlyBooking.find({ 
            ...query, 
            bookingStatus: 'completed' 
        }).select('charge hours');
        
        const totalEarnings = completedBookings.reduce((sum, booking) => {
            return sum + (booking.charge * booking.hours);
        }, 0);

        res.status(200).json({
            success: true,
            message: 'Driver bookings fetched successfully',
            data: bookings,
            summary: {
                ...summary,
                totalEarnings: totalEarnings
            },
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
        res.status(500).json({
            success: false,
            message: 'Error fetching driver bookings',
            error: error.message
        });
    }
});













// READ - Get all bookings
router.get('/', async (req, res) => {
  try {
    const bookings = await HourlyBooking.find().sort({ createdAt: -1 });
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

// READ - Get single booking by ID
router.get('/:id', async (req, res) => {
  try {
    const booking = await HourlyBooking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    res.status(200).json({
      success: true,
      data: booking
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// READ - Get bookings by customer ID
router.get('/customer/:customerId', async (req, res) => {
  try {
    const bookings = await HourlyBooking.find({ 
      customerID: req.params.customerId 
    }).sort({ createdAt: -1 });
    
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
    const bookings = await HourlyBooking.find({ 
      driverID: req.params.driverId 
    }).sort({ createdAt: -1 });
    
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
    const bookings = await HourlyBooking.find({ 
      bookingStatus: req.params.status 
    }).sort({ createdAt: -1 });
    
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
    const { bookingStatus } = req.body;
    
    const updatedBooking = await HourlyBooking.findByIdAndUpdate(
      req.params.id,
      { bookingStatus },
      { new: true }
    );
    
    if (!updatedBooking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
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
    const booking = await HourlyBooking.findById(req.params.id);
    
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    booking.isActive = !booking.isActive;
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

// // DELETE - Delete booking by ID
// router.delete('/:id', async (req, res) => {
//   try {
//     const deletedBooking = await HourlyBooking.findByIdAndDelete(req.params.id);
    
//     if (!deletedBooking) {
//       return res.status(404).json({
//         success: false,
//         message: 'Booking not found'
//       });
//     }
    
//     res.status(200).json({
//       success: true,
//       message: 'Booking deleted successfully'
//     });
//   } catch (error) {
//     res.status(500).json({
//       success: false,
//       message: error.message
//     });
//   }
// });


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