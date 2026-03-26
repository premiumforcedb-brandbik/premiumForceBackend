const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({



categoryID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
  // brand: {
  //   type: String,
  //   required: [true, 'Brand is required'],
  //   trim: true,
  //   maxlength: [50, 'Brand cannot exceed 50 characters']
  // },
  },
  brandID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Brand',
  },

  //  category: {
  //   type: String,
  //   required: [true, 'Category name is required'],
  //   trim: true,
  //   maxlength: [100, 'Category cannot exceed 100 characters']
  // },
 carName: {
    type: String,
    required: [true, 'Car name is required'],
    trim: true,
    maxlength: [100, 'Car name cannot exceed 100 characters']
  },
  // brand: {
  //   type: String,
  //   required: [true, 'Brand is required'],
  //   trim: true,
  //   maxlength: [50, 'Brand cannot exceed 50 characters']
  // },
  vat: {
    type: Number,
    required: false,
    trim: true,
    minLength: [0, 'VAT cannot be negative'],
    maxlength: [50, 'VAT cannot exceed 50 characters']
  },
  minCharge: {
    type: Number,
    required: false,
    trim: true,
    maxlength: [100, 'Minimum charge cannot exceed 100 characters']
  },
  minimumChargeDistance: {
    type: String,
    required:false,
    trim: true,
    maxlength: [50, 'Minimum charge distance cannot exceed 50 characters']
  },
  model: {
    type: String,
    required: [true, 'Model is required'],
    trim: true,
    maxlength: [50, 'Model cannot exceed 50 characters']
  },
  numberOfPassengers: {
    type: Number,
    required: [true, 'Number of passengers is required'],
    min: [1, 'Number of passengers must be at least 1'],
    max: [50, 'Number of passengers cannot exceed 50']
  },
  carImage: {
    key: {
      type: String,
      required: [true, 'Car image key is required']
    },
    url: {
      type: String,
      required: [true, 'Car image URL is required']
    },
    originalName: String,
    mimeType: String,
    size: Number
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  }
}, {
  timestamps: true
});


 


// Index for search functionality
carSchema.index({ carName: 'text', brand: 'text', model: 'text' });

module.exports = mongoose.model('Car', carSchema);