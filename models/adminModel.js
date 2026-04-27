const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');



const latLngSchema = new mongoose.Schema({
  lat: {
    type: Number,
    required: false
  },
  lng: {
    type: Number,
    required: false
  }
}, { _id: false });

const zoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [false, 'Zone name is required'],
    trim: true,
    unique: true
  },
  nameAr: {
    type: String,
    required: [false, 'Zone Arabic name is required'],
    trim: true
  },
  coordinates: {
    type: [latLngSchema],
    required: [false, 'Coordinates are required'],
    // validate: {
    //   validator: function (coords) {
    //     return coords && coords.length >= 1;
    //   },
    //   message: 'At least 1 coordinates are required to form a zone'
    // }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: false
  }
}, { _id: false });

const adminSchema = new mongoose.Schema({
  accessLevel: {
    type: Number,
    default: 1
  },
  zone: {
    type: [zoneSchema],
    required: [false, 'Zone is required'],
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },

  phoneNumber: {
    type: String,
    required: false,
    unique: true
  },
  countryCode: {
    type: String,
    required: false,
    default: '+966'
  },
  refreshToken: {
    type: String,
    default: null
  },

  email: {
    type: String,
    trim: true,
    lowercase: true,
    sparse: true,
    validate: {
      validator: function (v) {
        return !v || /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(v);
      },
      message: 'Please enter a valid email'
    }
  },

  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long']
  },

  role: {
    type: String,
    enum: ['admin', 'superadmin'],
    default: 'admin'
  },

  isActive: {
    type: Boolean,
    default: true
  },

  lastLogin: {
    type: Date
  },

  fcmToken: {
    type: String,
    default: null
  }

}, {
  timestamps: true
});

// SINGLE pre-save middleware for password hashing - THIS IS THE ONLY ONE
adminSchema.pre('save', async function () {  // Remove 'next' parameter
  try {
    if (!this.isModified('password')) {
      return;  // Early return completes the Promise
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    // No next() needed - async function returns Promise automatically
  } catch (error) {
    // Throw error to reject the Promise (Mongoose will catch it)
    throw error;
  }
});

// Compare password method
adminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Ensure virtuals are included in JSON output and remove sensitive data
adminSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

adminSchema.set('toObject', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

// Define indexes - ONLY ONCE
adminSchema.index({ email: 1 }, {
  unique: true,
  sparse: true,
  name: 'email_unique_idx'
});

// Check if model already exists to prevent OverwriteModelError
const Admin = mongoose.models.AdminUser || mongoose.model('AdminUser', adminSchema);

module.exports = Admin;