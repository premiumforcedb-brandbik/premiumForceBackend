const mongoose = require('mongoose');





const specialIDSchema = new mongoose.Schema({
    code: {
        type: String,
        required: [true, 'Code is required'],
        unique: true,
        trim: true,
        uppercase: true
    },
    text: {
        type: String,
        trim: true,
        default: '',
        required: false
    },
    companyID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        validate: {
            validator: function (v) {
                return mongoose.Types.ObjectId.isValid(v);
            },
            message: 'Invalid company ID'
        }
    },
    discountPercentage: {
        type: Number,
        required: [true, 'Discount percentage is required'],
        min: [0, 'Discount percentage cannot be less than 0'],
        max: [100, 'Discount percentage cannot exceed 100']
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

// Indexes for faster queries
specialIDSchema.index({ isActive: 1 });
specialIDSchema.index({ discountPercentage: 1 });

specialIDSchema.methods.incrementUsedCount = async function (incrementBy = 1) {
    if (incrementBy < 0) {
        throw new Error('Increment value cannot be negative');
    }

    this.usedCount += incrementBy;
    await this.save();
    return this;
}

// Method to decrement used count
specialIDSchema.methods.decrementUsedCount = async function (decrementBy = 1) {
    if (decrementBy < 0) {
        throw new Error('Decrement value cannot be negative');
    }

    const newCount = this.usedCount - decrementBy;

    if (newCount < 0) {
        throw new Error('Used count cannot be negative');
    }

    this.usedCount = newCount;
    await this.save();
    return this;
};

// Static method to find active special IDs
specialIDSchema.statics.findActive = function () {
    return this.find({ isActive: true });
};

// Static method to find by code
specialIDSchema.statics.findByCode = function (code) {
    return this.findOne({ code: code.toUpperCase(), isActive: true });
};

module.exports = mongoose.model('SpecialIDmodels', specialIDSchema);