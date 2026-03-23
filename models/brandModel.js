// const mongoose = require('mongoose');

// const brandSchema = new mongoose.Schema({
//   brandName: {
//     type: String,
//     required: true,
//     unique: true,
//     trim: true
//   },
//   brandIcon: {
//     type: {
//       key: String,
//       url: String,
//       originalName: String,
//       mimeType: String,
//       size: Number
//     },
//     default: null
//   },
//   isActive: {
//     type: Boolean,
//     default: true
//   }
// }, {
//   timestamps: true
// });

// module.exports = mongoose.model('Brand', brandSchema);




const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
  brandName: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  brandIcon: {
    type: {
      key: String,
      url: String,
      originalName: String,
      mimeType: String,
      size: Number
    },
    default: null
  },
  // Add categories array to brand
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
brandSchema.index({ isActive: 1 });
brandSchema.index({ categories: 1 });

// Method to get brand with populated categories
brandSchema.methods.getBrandWithCategories = async function() {
  const brand = this.toObject();
  await this.populate('categories', 'name image isActive priority description');
  return brand;
};

// Static method to find brands by category
brandSchema.statics.findByCategory = function(categoryId, activeOnly = true) {
  const query = { categories: categoryId };
  if (activeOnly) {
    query.isActive = true;
  }
  return this.find(query).populate('categories', 'name image');
};

// Static method to get all active brands with their active categories
brandSchema.statics.getActiveBrandsWithCategories = function() {
  return this.find({ isActive: true })
    .populate({
      path: 'categories',
      match: { isActive: true },
      select: 'name image priority description'
    })
    .sort({ brandName: 1 });
};

// Method to add category to brand
brandSchema.methods.addCategory = function(categoryId) {
  if (!this.categories.includes(categoryId)) {
    this.categories.push(categoryId);
    return this.save();
  }
  return this;
};

// Method to remove category from brand
brandSchema.methods.removeCategory = function(categoryId) {
  this.categories = this.categories.filter(
    cat => cat.toString() !== categoryId.toString()
  );
  return this.save();
};

module.exports = mongoose.model('Brand', brandSchema);