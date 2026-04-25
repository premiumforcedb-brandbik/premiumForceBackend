const mongoose = require('mongoose');
const User = require('../models/users_model');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected');

    const users = await User.find({ specialId: { $ne: null, $exists: true, $ne: "" } });
    console.log(`Found ${users.length} users with specialId`);

    users.forEach(u => {
        console.log(`User: ${u.username}, specialId: ${u.specialId}, isDiscountApproved: ${JSON.stringify(u.isDiscountApproved)}, type: ${typeof u.isDiscountApproved}`);
    });

    process.exit(0);
}

check().catch(err => {
    console.error(err);
    process.exit(1);
});

