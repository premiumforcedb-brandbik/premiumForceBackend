// models/Booking.js
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true
    // customize as needed
  },
  cityID: {
    type: String,
    required: true
  },
  airportID: {
    type: String
  },
  terminalID: {
    type: String
  },
  carID: {
    type: String
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
  flightNumber: {
    type: String
  },
  arrival: {
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
  pickupAddress:
  {
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
  // Make sure these field names match exactly with your code
  // carclass: {
  //   type: String,
  //   required: true
  // },
  // carbrand: {
  //   type: String,
  //   required: true
  // },

  carmodel: {
    type: String,
    required: true
  },
  //  carName: {
  //   type: String,
  //   required: true
  // },
  charge: {
    type: Number,
    required: true
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
    duration: Number // optional: audio duration in seconds
  },
  bookingStatus: {
    type: String,
    required: false,
  },
  vat: {
    type: Number,
    required: false,
  },

  timeLine: [{
    type: String,
    required: false
  }],
  passengerMobile: {
    type: String,
    required: true
  },
  passengerNames: [{
    type: String,
    required: true
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
  bookingStatus: {
    type: String,
    required: true,

  },
  TrackingTimeLine: [{
    type: String,
    required: true
  }],
  paymentStatus: {
    type: Boolean,
    default: false
  },
  paymentCompletedAt: {
    type: Date
  },
  rating: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
    // Example structure:
    // {
    //   "driver_rating": 5,
    //   "service_rating": 4,
    //   "punctuality": 5,
    //   "cleanliness": 4,
    //   "comment": "Great service!"
    // }
  }
}, {
  timestamps: true // Adds createdAt and updatedAt automatically
});





// Method to update booking status with timestamps
bookingSchema.methods.updateStatus = async function (status) {
  const validStatuses = ['pending', 'assigned', 'starttracking', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    throw new Error('Invalid status');
  }

  this.bookingStatus = status;

  // Set timestamps based on status
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