const Booking = require('../models/booking_model');
const Airport = require('../models/airportsModel');
const Terminal = require('../models/terminal_model');
const { getS3Url, deleteFromS3 } = require('../config/s3config');
const { notificationQueue } = require('../queues/notificationQueue');
const { BookingCategory } = require('../utils/constants');



// ============= CREATE BOOKING =============
createBooking = async (req, res) => {
  try {
    const customerID = req.customer.customerId;
    const { category, airportID, cityID, terminalID } = req.body;
    const bookingData = { ...req.body, customerID };

    if (category === BookingCategory.AIRPORT_ARRIVAL || category === BookingCategory.AIRPORT_DEPARTURE) {

      const airport = await Airport.findById(airportID);
      if (!airport) {
        return res.status(404).json({ success: false, message: 'Airport not found' });
      }

      if (airport.cityID.toString() !== cityID.toString()) {
        return res.status(400).json({
          success: false,
          message: 'The selected Airport does not belong to the selected City'
        });
      }


      const terminal = await Terminal.findById(terminalID);
      if (!terminal) {
        return res.status(404).json({ success: false, message: 'Terminal not found' });
      }

      if (terminal.airportID.toString() !== airportID.toString()) {
        return res.status(400).json({
          success: false,
          message: 'The selected Terminal does not belong to the selected Airport'
        });
      }

      // 3. Set Location Data from Airport
      if (category === BookingCategory.AIRPORT_ARRIVAL) {

        if (!airport.lat || !airport.long) {
          return res.status(400).json({
            success: false, message: 'Airport latitude and longitude are required'
          });
        }

        bookingData.pickupLat = airport.lat;
        bookingData.pickupLong = airport.long;
        bookingData.pickupAddress = airport.airportName;
      } else {
        if (!airport.lat || !airport.long) {
          return res.status(400).json({
            success: false, message: 'Airport latitude and longitude are required'
          });
        }

        bookingData.dropOffLat = airport.lat;
        bookingData.dropOffLong = airport.long;
        bookingData.dropOffAddress = airport.airportName;
      }
    }

    if (!bookingData.pickupLat || !bookingData.pickupLong || !bookingData.pickupAddress) {
      return res.status(400).json({ success: false, message: 'Pickup location (lat, long, address) is required' });
    }
    if (!bookingData.dropOffLat || !bookingData.dropOffLong || !bookingData.dropOffAddress) {
      return res.status(400).json({ success: false, message: 'Drop-off location (lat, long, address) is required' });
    }

    // Process Date
    bookingData.pickupDateTime = new Date(req.body.pickupDateTime);
    if (isNaN(bookingData.pickupDateTime.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
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
};

module.exports = {
  createBooking,
};
