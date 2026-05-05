const mongoose = require('mongoose');

const fleetHistorySchema = new mongoose.Schema({
    carID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Car',
        required: [true, 'Car ID is required']
    },
    driverID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Driver',
        required: [true, 'Driver ID is required']
    },
    takenOutAt: {
        type: Date,
        required: [true, 'Take out timestamp is required'],
        default: Date.now
    },
    returnedAt: {
        type: Date,
        required: false,
        default: null
    }
}, {
    timestamps: true
});

// Indexes for performance
fleetHistorySchema.index({ carID: 1 });
fleetHistorySchema.index({ driverID: 1 });
fleetHistorySchema.index({ takenOutAt: -1 });

module.exports = mongoose.model('FleetHistory', fleetHistorySchema);