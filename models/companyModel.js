const mongoose = require('mongoose');





const companySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Code is required'],
        unique: true,
        trim: true,
        uppercase: true
    },

    text: {
        type: String,
        trim: true,
        lowercase: true,
        default: '',
        required: false,
        validate: {
            validator: function (v) {
                // Allow empty string or valid email
                return v === '' || /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(v);
            },
            message: 'Please enter a valid email address'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// // Indexes for faster queries
// specialIDSchema.index({ isActive: 1 });



module.exports = mongoose.model('Company', companySchema);