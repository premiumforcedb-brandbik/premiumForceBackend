const mongoose = require('mongoose');

const fleetSchema = new mongoose.Schema({
    carID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Car',
        required: [true, 'Car ID is required']
    },
    carLicenseNumber: {
        type: String,
        required: [true, 'Car license number is required'],
        trim: true,
        maxlength: [50, 'Car license number cannot exceed 50 characters']
    },
    driverID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Driver',
        required: false,
        default: null
    },
    activeHistoryID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FleetHistory',
        default: null
    },
    lastTakenOutAt: {
        type: Date,
        required: false,
        default: null
    },
    lastReturnAt: {
        type: Date,
        required: false,
        default: null
    },
    isBusyCar: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
}, {
    timestamps: true
});

// Indexes for performance
fleetSchema.index({ carID: 1 });
fleetSchema.index({ driverID: 1 });
fleetSchema.index({ carLicenseNumber: 1 });

module.exports = mongoose.model('Fleet', fleetSchema);