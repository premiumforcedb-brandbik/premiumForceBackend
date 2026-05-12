const mongoose = require('mongoose');
const { BookingCategory } = require('../utils/constants');

const bookingSchema = new mongoose.Schema({

  cityID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: true
  },
  category: {
    type: String,
    enum: Object.values(BookingCategory),
    required: [true, 'Booking category (type) is required']
  },
  airportID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Airport',
    default: null
  },
  terminalID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Terminal',
    default: null
  },
  carID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Car',
    default: null
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
  stoppedAt: {
    type: Date,
    default: null
  },
  lastTakenOutAt: {
    type: Date
  },
  flightNumber: {
    type: String
  },
  pickupDateTime: {
    type: Date,
    required: true
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
  dropOffLat: {
    type: Number,
    required: true
  },
  dropOffLong: {
    type: Number,
    required: true
  },
  dropOffAddress: {
    type: String,
    required: true
  },

  charge: {
    type: Number,
    required: true
  },
  vat: {
    type: Number,
    default: 0
  },
  carimage: {
    key: String,
    url: String,
    originalName: String,
    mimeType: String,
    size: Number
  },
  specialRequestText: {
    type: String
  },
  specialRequestAudio: {
    key: String,
    url: String,
    originalName: String,
    mimeType: String,
    size: Number,
    duration: Number
  },
  passengerCount: {
    type: Number,
    required: true
  },
  passengerNames: [{
    type: String
  }],
  passengerMobile: {
    type: String,
    required: true
  },
  distance: {
    type: String,
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
  bookingStatus: {
    type: String,
    enum: ['pending', 'assigned', 'starttracking', 'completed', 'cancelled'],
    default: 'pending',
    required: true
  },
  TrackingTimeLine: [{
    type: String
  }],
  timeLine: [{
    type: String
  }],
  paymentStatus: {
    type: Boolean,
    default: false
  },
  paymentCompletedAt: {
    type: Date
  },
  driverAssignedAt: {
    type: Date
  },
  trackingStartedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  rating: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  allowSimilarVehicle: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for performance
bookingSchema.index({ cityID: 1 });
bookingSchema.index({ bookingStatus: 1 });
bookingSchema.index({ customerID: 1 });
bookingSchema.index({ driverID: 1 });
bookingSchema.index({ arrival: 1 });

// Method to update booking status with timestamps
bookingSchema.methods.updateStatus = async function (status) {
  const validStatuses = ['pending', 'assigned', 'starttracking', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status: "${status}". Valid: ${validStatuses.join(', ')}`);
  }

  this.bookingStatus = status;

  // Set timestamps based on status transition
  switch (status) {
    case 'assigned':
      this.driverAssignedAt = new Date();
      break;
    case 'starttracking':
      this.trackingStartedAt = new Date();
      break;
    case 'completed':
      this.completedAt = new Date();
      break;
  }

  await this.save();
  return this;
};

module.exports = mongoose.model('Booking', bookingSchema);