const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const HourlyBooking = require('../models/hourlyBookingModel');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const NotificationService = require('../services/notificationService');


// // Helper function for notifications (implement as needed)
// const notifyUser = async (userId, title, body, data) => {
//   console.log(`Notification to ${userId}:`, { title, body, data });
//   // Implement your notification logic here
//   return true;
// };

const { notifyUser } = require('../fcm');














// ============= CREATE HOURLY BOOKING with Existing Check =============
router.post('/', 
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

      const {
        hours, pickupLat, pickuplong, pickupAdddress,
        extraHours, category, model, brand, carName,
        charge, customerID, driverID, passsenrgersCount,
        passengerMobile, carClass, specialRequestText,
        bookingStatus, passengerNames, isActive
      } = req.body;

      // Validation for required fields
      if (!hours || !pickupLat || !pickuplong || !pickupAdddress || 
          !category || !model || !brand || !carName || !charge || 
          !customerID || !passsenrgersCount || !passengerMobile || 
          !carClass) {
        
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
          required: ['hours', 'pickupLat', 'pickuplong', 'pickupAdddress', 'category', 'model', 'brand', 'carName', 'charge', 'customerID', 'passsenrgersCount', 'passengerMobile', 'carClass'],
          received: Object.keys(req.body)
        });
      }

      // ========== EXISTING BOOKING CHECK ==========
      // Check if customer already has an active booking
      const activeBooking = await HourlyBooking.findOne({
        customerID: String(customerID).trim(),
        bookingStatus: { $in: ['pending', 'confirmed', 'starttracking'] },
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



        //    hours, pickupLat, pickuplong, pickupAdddress,
        // extraHours, category, model, brand, carName,
        // charge, customerID, driverID, passsenrgersCount,
        // passengerMobile, carClass, specialRequestText,
        // bookingStatus, passengerNames, isActive

    // Send notification
      try {
        // if (typeof notifyUser === 'function') {
          await notifyUser(
            customerID.trim(),
            '📅 Booking already exists',
            `Your hourly booking for ${carName} has been updated successfully.`,
            {
              type: 'booking_updated',
            //   bookingId: booking._id.toString(),
              status: bookingStatus
            }
          );
        // }
      } catch (notifyError) {
        console.error('Notification error:', notifyError);
      }





        return res.status(409).json({ // 409 Conflict
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

      // Optional: Check for duplicate booking within time window (e.g., same day)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const duplicateBooking = await HourlyBooking.findOne({
        customerID: String(customerID).trim(),
        createdAt: { $gte: today, $lt: tomorrow },
        carName: String(carName).trim()
      });

      if (duplicateBooking) {
        console.log('Duplicate booking attempt detected:', duplicateBooking._id);
        // Don't block, just log - or you can block if needed
      }
      // ========== END EXISTING CHECK ==========

      // Parse passengerNames
      let parsedPassengerNames = [];
      if (passengerNames) {
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

      // Handle car image
      let carImageUrl = null;
      if (req.files && req.files.carImage && req.files.carImage.length > 0) {
        carImageUrl = getS3Url(req.files.carImage[0].key);
        console.log('Using uploaded car image:', carImageUrl);
      } else if (req.body.carImage && typeof req.body.carImage === 'string') {
        carImageUrl = req.body.carImage;
        console.log('Using car image URL from body:', carImageUrl);
      }

      // Handle audio
      let audioUrl = null;
      if (req.files && req.files.specialRequestAudio && req.files.specialRequestAudio.length > 0) {
        audioUrl = getS3Url(req.files.specialRequestAudio[0].key);
        console.log('Using uploaded audio:', audioUrl);
      } else if (req.body.specialRequestAudio && typeof req.body.specialRequestAudio === 'string') {
        audioUrl = req.body.specialRequestAudio;
        console.log('Using audio URL from body:', audioUrl);
      }

      // Create booking object
      const bookingData = {
        hours: parseInt(hours),
        pickupLat: parseFloat(pickupLat),
        pickuplong: parseFloat(pickuplong),
        pickupAdddress: String(pickupAdddress).trim(),
        category: String(category).trim(),
        model: String(model).trim(),
        brand: String(brand).trim(),
        carName: String(carName).trim(),
        charge: parseFloat(charge),
        customerID: String(customerID).trim(),
        passsenrgersCount: parseInt(passsenrgersCount),
        passengerMobile: String(passengerMobile).trim(),
        carClass: String(carClass).trim(),
        carImage: carImageUrl,
        extraHours: extraHours ? parseInt(extraHours) : 0,
        bookingStatus: bookingStatus || 'pending',
        isActive: isActive === 'true' || isActive === true,
        passengerNames: parsedPassengerNames,
        specialRequestText: specialRequestText || ''
      };

      // Handle driverID
      if (!driverID || driverID === '' || driverID === 'null' || driverID === 'undefined') {
        bookingData.driverID = null;
      } else {
        bookingData.driverID = String(driverID).trim();
      }

      // Add audio if available
      if (audioUrl) {
        bookingData.specialRequestAudio = audioUrl;
      }

      console.log('Final booking data:', JSON.stringify(bookingData, null, 2));

      // Create and save the booking
      const booking = new HourlyBooking(bookingData);
      const savedBooking = await booking.save();

       // Send notification
      try {
        if (typeof notifyUser === 'function') {
          await notifyUser(
            booking.customerID,
            '📅 Booking Created',
            `Your hourly booking for ${booking.carName} has been created successfully.`,
            {
              type: 'booking_created',
              bookingId: booking._id.toString(),
              status: booking.bookingStatus
            }
          );
        }
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

      // Validate booking ID
      if (!mongoose.Types.ObjectId.isValid(bookingId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid booking ID format'
        });
      }

      // Find existing booking
      const existingBooking = await HourlyBooking.findById(bookingId);
      
      if (!existingBooking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found'
        });
      }

      // ========== EXISTING BOOKING CHECK FOR UPDATE ==========
      // Check if trying to update a cancelled/completed booking
      if (existingBooking.bookingStatus === 'cancelled' || existingBooking.bookingStatus === 'completed') {
        return res.status(400).json({
          success: false,
          message: `Cannot update a ${existingBooking.bookingStatus} booking`,
          currentStatus: existingBooking.bookingStatus
        });
      }

      // Check if driver is being assigned to another active booking
      const { driverID } = req.body;
      if (driverID && driverID !== 'null' && driverID !== '' && driverID !== 'undefined') {
        const driverActiveBooking = await HourlyBooking.findOne({
          _id: { $ne: bookingId },
          driverID: String(driverID).trim(),
          bookingStatus: { $in: ['confirmed', 'in-progress'] },
          isActive: true
        });

        if (driverActiveBooking) {
          return res.status(409).json({
            success: false,
            message: 'Driver already assigned to another active booking',
            data: {
              existingBookingId: driverActiveBooking._id,
              existingStatus: driverActiveBooking.bookingStatus
            }
          });
        }
      }

      // Check if changing customerID - verify new customer doesn't have active booking
      const { customerID } = req.body;
      if (customerID && customerID !== existingBooking.customerID) {
        const customerActiveBooking = await HourlyBooking.findOne({
          _id: { $ne: bookingId },
          customerID: String(customerID).trim(),
          bookingStatus: { $in: ['pending', 'confirmed', 'in-progress'] },
          isActive: true
        });

        if (customerActiveBooking) {
          return res.status(409).json({
            success: false,
            message: 'New customer already has an active booking',
            data: {
              existingBookingId: customerActiveBooking._id,
              existingStatus: customerActiveBooking.bookingStatus
            }
          });
        }
      }
      // ========== END EXISTING CHECK ==========

      // Extract fields and clean them
      const rawBody = req.body;
      
      // Helper function to clean string values
      const cleanString = (value) => {
        if (value === undefined || value === null) return value;
        return String(value).trim();
      };

      // Clean all string fields
      const cleanedBody = {};
      Object.keys(rawBody).forEach(key => {
        cleanedBody[key] = cleanString(rawBody[key]);
      });

      console.log('🧹 Cleaned body:', cleanedBody);

      const {
        hours, pickupLat, pickuplong, pickupAdddress,
        extraHours, category, model, brand, carName,
        charge, customerID: newCustomerID, driverID: newDriverID, passsenrgersCount,
        passengerMobile, carClass, specialRequestText,
        bookingStatus, passengerNames, isActive
      } = cleanedBody;

      // Build update object
      const updateData = {};

      // Numeric fields
      if (hours !== undefined && hours !== '') updateData.hours = parseInt(hours);
      if (pickupLat !== undefined && pickupLat !== '') updateData.pickupLat = parseFloat(pickupLat);
      if (pickuplong !== undefined && pickuplong !== '') updateData.pickuplong = parseFloat(pickuplong);
      if (charge !== undefined && charge !== '') updateData.charge = parseFloat(charge);
      if (passsenrgersCount !== undefined && passsenrgersCount !== '') updateData.passsenrgersCount = parseInt(passsenrgersCount);
      if (extraHours !== undefined && extraHours !== '') updateData.extraHours = parseInt(extraHours);

      // String fields
      if (pickupAdddress !== undefined && pickupAdddress !== '') updateData.pickupAdddress = pickupAdddress;
      if (category !== undefined && category !== '') updateData.category = category;
      if (model !== undefined && model !== '') updateData.model = model;
      if (brand !== undefined && brand !== '') updateData.brand = brand;
      if (carName !== undefined && carName !== '') updateData.carName = carName;
      if (newCustomerID !== undefined && newCustomerID !== '') updateData.customerID = newCustomerID;
      if (passengerMobile !== undefined && passengerMobile !== '') updateData.passengerMobile = passengerMobile;
      if (carClass !== undefined && carClass !== '') updateData.carClass = carClass;
      if (specialRequestText !== undefined) updateData.specialRequestText = specialRequestText || '';

      // Handle bookingStatus
      if (bookingStatus !== undefined && bookingStatus !== '') {
        const cleanStatus = bookingStatus.toLowerCase().trim();
        console.log('📊 Status comparison:', {
          original: `"${bookingStatus}"`,
          cleaned: `"${cleanStatus}"`,
          existing: `"${existingBooking.bookingStatus}"`
        });

        // Define valid statuses
        const validStatuses = ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'];
        
        // Validate the cleaned status
        if (!validStatuses.includes(cleanStatus)) {
          return res.status(400).json({
            success: false,
            message: `Invalid status value: "${bookingStatus}"`,
            validStatuses: validStatuses,
            note: 'Status should be one of: pending, confirmed, in-progress, completed, cancelled'
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
        if (cleanStatus !== existingBooking.bookingStatus) {
          if (validTransitions[existingBooking.bookingStatus]?.includes(cleanStatus)) {
            updateData.bookingStatus = cleanStatus;
          } else {
            return res.status(400).json({
              success: false,
              message: `Invalid status transition from "${existingBooking.bookingStatus}" to "${bookingStatus}"`,
              allowedTransitions: validTransitions[existingBooking.bookingStatus] || []
            });
          }
        }
      }

      // Boolean
      if (isActive !== undefined && isActive !== '') {
        updateData.isActive = isActive === 'true' || isActive === true;
      }

      // Handle driverID
      if (newDriverID !== undefined) {
        if (newDriverID === null || newDriverID === '' || newDriverID === 'null' || newDriverID === 'undefined') {
          updateData.driverID = null;
        } else {
          updateData.driverID = newDriverID;
        }
      }

      // Handle passengerNames
      if (passengerNames !== undefined && passengerNames !== '') {
        try {
          if (typeof passengerNames === 'string') {
            const trimmed = passengerNames.trim();
            if (trimmed.startsWith('[')) {
              updateData.passengerNames = JSON.parse(trimmed);
            } else {
              updateData.passengerNames = trimmed.split(',').map(name => name.trim());
            }
          } else if (Array.isArray(passengerNames)) {
            updateData.passengerNames = passengerNames;
          }
        } catch (e) {
          console.error('Error parsing passengerNames:', e);
          updateData.passengerNames = String(passengerNames).split(',').map(name => name.trim());
        }
      }

      // Handle file uploads
      if (req.files) {
        if (req.files.carImage && req.files.carImage.length > 0) {
          // Delete old image
          if (existingBooking.carImage) {
            // Define extractKeyFromUrl here if not imported
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
          
          const file = req.files.carImage[0];
          updateData.carImage = getS3Url(file.key);
          console.log('🖼️ Car image updated:', updateData.carImage);
        }

        if (req.files.specialRequestAudio && req.files.specialRequestAudio.length > 0) {
          // Delete old audio
          if (existingBooking.specialRequestAudio) {
            // Define extractKeyFromUrl here if not imported
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
          
          const file = req.files.specialRequestAudio[0];
          updateData.specialRequestAudio = getS3Url(file.key);
          console.log('🎵 Audio file updated:', updateData.specialRequestAudio);
        }
      }

      // If no fields to update
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No fields provided for update'
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
        if (typeof notifyUser === 'function') {
          await notifyUser(
            updatedBooking.customerID,
            '📅 Booking Updated',
            `Your hourly booking for ${updatedBooking.carName} has been updated successfully.`,
            {
              type: 'booking_updated',
              bookingId: updatedBooking._id.toString(),
              status: updatedBooking.bookingStatus
            }
          );
        }
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