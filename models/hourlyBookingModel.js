const mongoose = require('mongoose');

const hourlyBookingSchema = new mongoose.Schema({
    category: {
    type: String,
    required: false
   // customize as needed
  },
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
    default: 0},
  model: {
    type: String,
    required: true
  },
   categoryID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
            required: true
      },
  brandID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Brand',
        required: true
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
    required: false
  },
extraPayment: {
    type: Number,
    default: 0,
    required: false
  },
  startedAt: {
    type: Date,
    default: null},
  stoppedAt: {
    type: Date,
    default: null
  },
   extraTransactionID: {
    type: String,
    required: false
  },
   extraOrderID: {
    type: String,
    required: false
  },
    extraDiscount: {
    type: Number,
    required: false
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
