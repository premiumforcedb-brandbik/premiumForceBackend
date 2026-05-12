const Driver = require('../models/driver_model');
const Fleet = require('../models/FleetModel');
const Zone = require('../models/zoneModel');
const { notificationQueue } = require('../queues/notificationQueue');
const { getAllLiveFleets } = require('../services/afaqyService');
const mongoose = require('mongoose');
const Booking = require('../models/booking_model');
const HourlyBooking = require('../models/hourlyBookingModel');
const Car = require('../models/car_model');

/**
 * @desc    Assign a driver and fleet to a booking (Regular or Hourly)
 * @route   POST /api/admin/assignments/assign
 * @access  Private (Admin only)
 */
const assignBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { bookingID, driverID, fleetID, bookingType } = req.body;

    // 1. Validate existence and status of Driver
    const driver = await Driver.findById(driverID).session(session);
    if (!driver) {
      throw new Error('Driver not found');
    }

    if (!driver.isActive) {
      throw new Error('Driver is not active');
    }
    // Note: We don't block based on isBusy because a driver might be assigned 
    // to a future booking while currently on a trip.

    // 2. Validate existence and status of Fleet
    const fleet = await Fleet.findById(fleetID).populate('carID').session(session);
    if (!fleet) {
      throw new Error('Fleet vehicle not found');
    }
    if (!fleet.isActive) {
      throw new Error('Fleet vehicle is not active');
    }

    // Check if the fleet is already busy with another driver (Shift-based)
    if (fleet.isBusyCar && fleet.driverID && fleet.driverID.toString() !== driverID.toString()) {
      throw new Error(`Fleet vehicle ${fleet.carLicenseNumber} is currently taken out by another driver`);
    }

    // 3. Find and Update the Booking
    let bookingModel = bookingType === 'hourly' ? HourlyBooking : Booking;
    const booking = await bookingModel.findById(bookingID).populate('carID').session(session);

    if (!booking) {
      throw new Error(`${bookingType === 'hourly' ? 'Hourly booking' : 'Booking'} not found`);
    }

    // Check car compatibility
    const requestedCar = booking.carID;
    const fleetCar = fleet.carID;

    if (!requestedCar) {
      throw new Error('Booking has no car assigned');
    }

    if (!booking.allowSimilarVehicle) {
      // Must be the exact same car model
      if (fleetCar._id.toString() !== requestedCar._id.toString()) {
        throw new Error(`Assignment failed: This booking requires exactly a ${requestedCar.carName}. Selected fleet is a ${fleetCar.carName}.`);
      }
    } else {
      // Must be in the same category
      const requestedCategoryID = requestedCar.categoryID?.toString();
      const fleetCategoryID = fleetCar.categoryID?.toString();

      if (!requestedCategoryID || !fleetCategoryID || requestedCategoryID !== fleetCategoryID) {
        throw new Error(`Assignment failed: Selected fleet category does not match the requested category.`);
      }
    }

    if (booking.bookingStatus === 'completed' || booking.bookingStatus === 'cancelled') {
      throw new Error(`Cannot assign to a ${booking.bookingStatus} booking`);
    }

    // Check if this is a reassignment
    const oldDriverID = booking.driverID;
    const isReassignment = oldDriverID && oldDriverID.toString() !== driverID.toString();

    // Update the booking with assignment details
    booking.driverID = driverID;
    booking.fleetID = fleetID;
    booking.bookingStatus = 'assigned';
    booking.driverAssignedAt = new Date();

    // Add to timeline
    const timelineEntry = isReassignment
      ? `Reassigned from driver ${oldDriverID} to ${driverID} at ${new Date().toISOString()}`
      : `Assigned to driver ${driverID} at ${new Date().toISOString()}`;

    if (!booking.timeLine) booking.timeLine = [];
    booking.timeLine.push(timelineEntry);

    await booking.save({ session });

    // 4. Commit transaction
    await session.commitTransaction();
    session.endSession();

    // 5. Send Notifications (Offloaded to Queue)
    try {
      const typeLabel = bookingType === 'hourly' ? 'Hourly Booking' : 'Booking';

      // Notify Old Driver if reassigned
      if (isReassignment) {
        await notificationQueue.add('driver_unassigned', {
          type: 'driver',
          recipientId: oldDriverID,
          title: `⚠️ Booking Reassigned`,
          body: `The ${bookingType} booking #${bookingID} has been reassigned to another driver.`,
          data: { type: 'booking_reassigned', bookingId: bookingID }
        });
      }

      // Add driver notification to queue
      await notificationQueue.add('driver_notification', {
        type: 'driver',
        recipientId: driverID,
        title: `📅 ${typeLabel} Assigned!`,
        body: `You have been assigned to a new ${bookingType} booking.`,
        data: {
          type: 'booking_assigned',
          bookingId: bookingID,
          bookingType,
          status: 'assigned'
        }
      });

      // Add user notification to queue
      await notificationQueue.add('user_notification', {
        type: 'user',
        recipientId: booking.customerID,
        title: 'Driver Assigned',
        body: `A driver and vehicle have been assigned to your ${bookingType} booking.`,
        data: {
          type: 'driver_assigned',
          bookingId: bookingID,
          bookingType,
          status: 'assigned'
        }
      });

    } catch (queueErr) {
      console.error('Queue adding error (ignoring to prevent API failure):', queueErr);
    }

    res.status(200).json({
      success: true,
      message: 'Booking successfully assigned to driver and fleet',
      data: {
        bookingID,
        driverName: driver.driverName,
        carLicenseNumber: fleet.carLicenseNumber,
        bookingType
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Assign Booking Error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error during booking assignment'
    });
  }
};

/**
 * @desc    Get list of available drivers with their current status
 * @route   GET /api/admin/assignments/available-drivers
 * @access  Private (Admin only)
 */
const getAvailableDrivers = async (req, res) => {
  try {
    const { search } = req.query;

    let query = { isActive: true };

    // If dispatcher, force city scoping
    const adminCityID = req.admin?.cityID?._id || req.admin?.cityID;
    if (req.admin?.accessLevel === 1 && adminCityID) {
      query.cityID = adminCityID;
    }

    if (search) {
      query.$or = [
        { driverName: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const drivers = await Driver.find(query)
      .select('driverName phoneNumber email profileImage isWorkstarted isBusy cityID')
      .populate('cityID', 'cityName')
      .lean();

    // Transform to include status labels
    const formattedDrivers = drivers.map(d => ({
      ...d,
      status: {
        shift: d.isWorkstarted ? 'online' : 'offline',
        availability: d.isBusy ? 'busy' : 'free'
      }
    }));

    res.status(200).json({
      success: true,
      count: formattedDrivers.length,
      data: formattedDrivers
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get list of available fleets with live GPS data
 * @route   GET /api/admin/assignments/available-fleets
 * @access  Private (Admin only)
 */
const getAvailableFleets = async (req, res) => {
  try {
    const { onlyAvailable, bookingID, bookingType } = req.query;


    if (!bookingID || !bookingType) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and Booking Type are required'
      });
    }

    let query = { isActive: true };
    if (onlyAvailable === 'true') {
      query.isBusyCar = false;
    }

    // 1. Handle Booking-specific filtering (CarID or Category)
    if (bookingID && bookingType) {
      const bookingModel = bookingType === 'hourly' ? HourlyBooking : Booking;
      const booking = await bookingModel.findById(bookingID).populate('carID').lean();

      if (!booking) {
        return res.status(404).json({ success: false, message: 'Booking not found' });
      }

      const requestedCarID = booking.carID?._id || booking.carID;
      if (!requestedCarID) {
        return res.status(400).json({ success: false, message: 'Booking has no car assigned' });
      }

      if (booking.allowSimilarVehicle) {
        // Find all cars in the same category
        const categoryID = booking.carID?.categoryID;
        if (categoryID) {
          const similarCars = await Car.find({ categoryID }).select('_id').lean();
          const carIDs = similarCars.map(c => c._id);
          query.carID = { $in: carIDs };
        } else {
          query.carID = requestedCarID;
        }
      } else {
        query.carID = requestedCarID;
      }
    }

    // 2. Fetch Live GPS from Afaqy (needed for city filtering)
    let liveUnits = [];
    try {
      liveUnits = await getAllLiveFleets();
    } catch (err) {
      console.error('Afaqy Fetch Error:', err.message);
    }

    // 3. City scoping for dispatchers (Live GPS → Zone check)
    if (req.admin?.accessLevel === 1) {
      const adminCityID = req.admin.cityID?._id || req.admin.cityID;
      if (!adminCityID) {
        return res.status(403).json({ success: false, message: 'Dispatcher has no city assigned' });
      }

      const zones = await Zone.find({ cityID: adminCityID, isActive: true });
      if (!zones.length) {
        return res.status(200).json({ success: true, count: 0, data: [] });
      }

      const cityPlates = liveUnits
        .filter(unit => {
          const lat = unit.last_update?.lat;
          const lng = unit.last_update?.lng;
          if (!lat || !lng) return false;
          return zones.some(z => z.containsPoint(lat, lng));
        })
        .map(unit => unit.name?.trim());

      query.carLicenseNumber = { $in: cityPlates };
    }

    // 4. Fetch from Database
    const dbFleets = await Fleet.find(query)
      .populate('carID', 'carName model image numberOfPassengers categoryID')
      .lean();

    // 5. Merge Data
    const formattedFleets = dbFleets.map(fleet => {
      const live = liveUnits.find(u => u.name?.trim() === fleet.carLicenseNumber?.trim());

      return {
        ...fleet,
        live: live ? {
          lat: live.last_update?.lat,
          lng: live.last_update?.lng,
          speed: live.last_update?.spd || 0,
          lastUpdate: live.last_update?.dts,
          status: live.last_update?.unit_state?.motion?.state || 'unknown'
        } : null
      };
    });

    res.status(200).json({
      success: true,
      count: formattedFleets.length,
      data: formattedFleets
    });

  } catch (error) {
    console.error('Get Available Fleets Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  assignBooking,
  getAvailableDrivers,
  getAvailableFleets
};
