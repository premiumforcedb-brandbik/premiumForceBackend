const mongoose = require('mongoose');

const specialIDSchema = new mongoose.Schema({
    code: {
        type: String,
        required: [true, 'Code is required'],
        unique: true,
        trim: true,
    },
    text: {
        type: String,
        trim: true,
        default: '',
        required: false
    },
    discountPercentage: {
        type: Number,
        required: [true, 'Discount percentage is required'],
        min: [0, 'Discount percentage cannot be less than 0'],
        max: [100, 'Discount percentage cannot exceed 100'],
        validate: {
            validator: function(value) {
                return Number.isFinite(value);
            },
            message: 'Discount percentage must be a valid number'
        }
    },
    usedCount: {
        type: Number,
        default: 0,
        min: [0, 'Used count cannot be negative']
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for faster queries
// specialIDSchema.index({ code: 1 });
specialIDSchema.index({ isActive: 1 });
specialIDSchema.index({ discountPercentage: 1 });

// // Method to increment used count
specialIDSchema.methods.incrementUsedCount = async function() {
    this.usedCount += 1;
    return this.save();
};

// Static method to find active special IDs
specialIDSchema.statics.findActive = function() {
    return this.find({ isActive: true });
};

module.exports = mongoose.model('SpecialIDmodels', specialIDSchema);