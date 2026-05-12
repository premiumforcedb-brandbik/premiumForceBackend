const mongoose = require('mongoose');

const hourlyBookingSchema = new mongoose.Schema({
  hours: {
    type: Number,
    required: true
  },
  vat: {
    type: Number,
    default: 0
  },
  extraVat: {
    type: Number,
    default: 0
  },
  pickupLat: {
    type: Number,
    required: true
  },
  pickupLong: {
    type: Number,
    required: true
  },
  pickupAddress: {
    type: String,
    required: true
  },
  pickupDateTime: {
    type: Date,
    required: true,
    default: Date.now
  },
  extraHours: {
    type: Number,
    default: 0
  },
  transactionID: {
    type: String,
    required: true
  },
  orderID: {
    type: String,
    required: true
  },
  discountPercentage: {
    type: Number,
    default: 0
  },


  carID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Car',
    required: true
  },
  cityID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: true
  },
  charge: {
    type: Number,
    required: true
  },
  customerID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  driverID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    default: null
  },
  fleetID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Fleet',
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
  passengerNames: [{
    type: String
  }],
  carClass: {
    type: String,
    required: true
  },
  carImage: {
    type: String,
    default: null
  },
  extraPayment: {
    type: Number,
    default: 0
  },
  startedAt: {
    type: Date,
    default: null
  },
  stoppedAt: {
    type: Date,
    default: null
  },
  extraTransactionID: {
    type: String,
    default: null
  },
  extraOrderID: {
    type: String,
    default: null
  },
  extraDiscount: {
    type: Number,
    default: 0
  },
  extraPaymentCompleted: {
    type: Boolean,
    default: false
  },
  specialRequestText: {
    type: String,
    default: ''
  },
  specialRequestAudio: {
    type: String,
    default: null
  },
  bookingStatus: {
    type: String,
    enum: ['pending', 'assigned', 'starttracking', 'completed', 'cancelled'],
    default: 'pending',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  allowSimilarVehicle: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for performance
hourlyBookingSchema.index({ cityID: 1 });
hourlyBookingSchema.index({ bookingStatus: 1 });
hourlyBookingSchema.index({ customerID: 1 });
hourlyBookingSchema.index({ driverID: 1 });
hourlyBookingSchema.index({ pickupDateTime: 1 });

module.exports = mongoose.model('HourlyBooking', hourlyBookingSchema);
