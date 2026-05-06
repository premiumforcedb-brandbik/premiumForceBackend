const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const FleetHistory = require('../models/FleetHistoryModel');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');


// ==================== READ (GET HISTORY BY CAR ID) ====================
// Get full history of a specific vehicle
router.get('/fleets/:fleetID/history',
    authenticateToken, authorizeAdmin,
    async (req, res) => {
        try {

            const { fleetID } = req.params;

            const { takenOutAt,
                returnedAt, page = 1, limit = 10 } = req.query;

            // Build filter object - Changed carID to fleetID
            const filter = { fleetID: fleetID };


            if (takenOutAt === 'null' || takenOutAt === '') {
                filter.takenOutAt = null;
            } else if (takenOutAt) {
                filter.takenOutAt = takenOutAt;
            }

            if (returnedAt === 'null' || returnedAt === '') {
                filter.returnedAt = null;
            } else if (returnedAt) {
                filter.returnedAt = returnedAt;
            }
            // Pagination
            const skip = (page - 1) * limit;

            const history = await FleetHistory.find(filter)
                .populate({
                    path: 'fleetID',
                    populate: { path: 'carID', select: 'carName model carLicenseNumber carImage' }
                })
                .populate('driverID', 'driverName name phoneNumber email')
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