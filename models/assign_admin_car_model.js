// models/assign_admin_driver_model.js
const mongoose = require('mongoose');

const adminAssignCarSchema = new mongoose.Schema(
    {
        adminID: {
            type: String,
            required: true
        },
        vehicleID: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Fleet',
            required: true
        },
        driverID: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Driver',
            required: true
        },

        bookingID: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Booking',
            required: true
        },
        bookingDate: {
            type: String,
            required: true
        },

        // assignedAt: {
        //     required: [true, 'Assigned date and time is required'],
        //     type: Date,
        //     // default: Date.now
        // }
    },
    {
        timestamps: true // ✅ This is CORRECT - outside the fields object
    }
);

module.exports = mongoose.model('AdminAssignCar', adminAssignCarSchema);
