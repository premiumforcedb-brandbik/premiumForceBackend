const mongoose = require('mongoose');

const hourlyRouteSchema = new mongoose.Schema({
  vehicleID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Car',
    required: [true, 'Vehicle is required']
  },
  fromCity: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'From city is required']
  },
  toCity: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'To city is required']
  },
  charge: {
    type: Number,
    required: [true, 'Charge is required'],
    min: [0, 'Charge cannot be negative']
  },
  hour: {
    type: Number,
    default: 1,
    min: [1, 'Hour must be at least 1']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate routes for same vehicle
hourlyRouteSchema.index({ vehicleID: 1, fromCity: 1, toCity: 1, hour: 1 }, { unique: true });

// Virtual field for total charge (charge * hour)
hourlyRouteSchema.virtual('totalCharge').get(function() {
  return this.charge * this.hour;
});

// Method to toggle active status
hourlyRouteSchema.methods.toggleActive = function() {
  this.isActive = !this.isActive;
  return this.save();
};

// Static method to find active routes
hourlyRouteSchema.statics.findActiveRoutes = function() {
  return this.find({ isActive: true }).populate('vehicleID fromCity toCity');
};

module.exports = mongoose.model('HourlyRoute', hourlyRouteSchema);