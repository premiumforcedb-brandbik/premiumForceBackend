const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const FleetHistory = require('../models/FleetHistoryModel');


// ==================== READ (GET HISTORY BY CAR ID) ====================
// Get full history of a specific vehicle
router.get('/fleets/:carID/history', async (req, res) => {
    try {
        const { carID } = req.params;
        const { page = 1, limit = 10 } = req.query;

        // Build filter object
        const filter = { carID: carID };

        // Pagination
        const skip = (page - 1) * limit;

        const history = await FleetHistory.find(filter)
            .populate('carID', 'carName model carLicenseNumber carImage')
            .populate('driverID', 'driverName phoneNumber email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));


        const totalItems = await FleetHistory.countDocuments(filter);

        res.status(200).json({
            success: true,
            count: history.length,
            history: history,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalItems / limit),
                totalItems: totalItems,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Fetch fleet history error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching vehicle history',
            error: error.message
        });
    }
});

module.exports = router;