const mongoose = require('mongoose');

const fleetHistorySchema = new mongoose.Schema({
    carID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Car',
    },
    driverID: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Driver',
    },
    lastTakenOutAt: {
        type: Date,
        required: false,
    },
    lastReturnAt: {
        type: Date,
        required: false,
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

module.exports = mongoose.model('FleetHistory', fleetHistorySchema);