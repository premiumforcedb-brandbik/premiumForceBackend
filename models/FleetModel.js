const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({

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
    carLicenseNumber: {
        type: String,
        required: [true, 'Car license number is required'],
        trim: true,
        maxlength: [50, 'Car license number cannot exceed 50 characters']
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

module.exports = mongoose.model('Fleet', carSchema);