// models/ZonePricing.js
const mongoose = require('mongoose');

const zonePricingSchema = new mongoose.Schema({
  zoneFromId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    required: [true, 'Source zone is required']
  },
  zoneToId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    required: [true, 'Destination zone is required']
  },
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Car', // Assuming you have a Car model
    required: [true, 'Vehicle is required']
  },
  charge: {
    type: Number,
    required: [true, 'Charge is required'],
    min: [0, 'Charge cannot be negative']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Compound unique index to prevent duplicate zone pairs for same vehicle
zonePricingSchema.index(
  { zoneFromId: 1, zoneToId: 1, vehicleId: 1 }, 
  { unique: true }
);

// Indexes for faster queries
zonePricingSchema.index({ zoneFromId: 1 });
zonePricingSchema.index({ zoneToId: 1 });
zonePricingSchema.index({ vehicleId: 1 });
zonePricingSchema.index({ isActive: 1 });

module.exports = mongoose.model('ZonePricing', zonePricingSchema);
