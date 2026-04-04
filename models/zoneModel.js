// models/Zone.js
const mongoose = require('mongoose');

const latLngSchema = new mongoose.Schema({
  lat: {
    type: Number,
    required: true
  },
  lng: {
    type: Number,
    required: true
  }
}, { _id: false });

const zoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Zone name is required'],
    trim: true,
    unique: true
  },
  nameAr: {
    type: String,
    required: [true, 'Zone Arabic name is required'],
    trim: true
  },
  cityID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'City ID is required']
  },
  coordinates: {
    type: [latLngSchema],
    required: [true, 'Coordinates are required'],
    validate: {
      validator: function(coords) {
        return coords && coords.length >= 3;
      },
      message: 'At least 3 coordinates are required to form a zone'
    }
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

// Indexes for better query performance
zoneSchema.index({ cityID: 1 });
// zoneSchema.index({ name: 1 });
zoneSchema.index({ isActive: 1 });
zoneSchema.index({ cityID: 1, isActive: 1 });

// Method to check if a point is within the zone (Polygon)
zoneSchema.methods.containsPoint = function(lat, lng) {
  // Ray casting algorithm to check if point is inside polygon
  let inside = false;
  const points = this.coordinates;
  
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng, yi = points[i].lat;
    const xj = points[j].lng, yj = points[j].lat;
    
    const intersect = ((yi > lat) != (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    
    if (intersect) inside = !inside;
  }
  
  return inside;
};

module.exports = mongoose.model('Zone', zoneSchema);


