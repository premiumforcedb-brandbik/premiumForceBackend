const mongoose = require('mongoose');

const hourlyBookingSchema = new mongoose.Schema({
  hours: {
    type: Number,
    required: true
  },
  pickupLat: {
    type: Number,
    required: true
  },
  pickuplong: {
    type: Number,
    required: true
  },
  pickupAdddress: {
    type: String,
    required: true
  },
  extraHours: {
    type: Number,
    default: 0
  },
  category: {
    type: String,
    required: true
  },
  model: {
    type: String,
    required: true
  },
  brand: {
    type: String,
    required: true
  },
  carName: {
    type: String,
    required: true
  },
  charge: {
    type: Number,
    required: true
  },
  customerID: {
    type: String,
    required: true
  },
  driverID: {
    type: String,
    default: null
  },
  passsenrgersCount: {
    type: Number,
    required: true
  },
  passengerMobile: {
    type: String,
    required: true
  },
  carClass: {
    type: String,
    required: true
  },
  carImage: {
    type: String,
    required: true
  },
  specialRequestText: {
    type: String,
    default: ''
  },
  specialRequestAudio: {
    type: String,
    required: false,
    default: null
  },
  bookingStatus: {
    type: String,
    default: 'pending'
  },
  passengerNames: [{
    type: String
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('HourlyBooking', hourlyBookingSchema);