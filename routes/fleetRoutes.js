const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Fleet = require('../models/FleetModel');
const Car = require('../models/car_model');
const Driver = require('../models/driver_model');
const Booking = require('../models/booking_model');
const HourlyBooking = require('../models/hourlyBookingModel');
const AdminAssignCar = require('../models/assign_admin_car_model');


// ==================== CREATE ====================
// Create a new fleet/car entry
router.post('/api/fleets', async (req, res) => {
    console.log(req.body);
    try {
        const { carID, driverID, carLicenseNumber, isBusyCar, isActive } = req.body;
        if (carID) {
            const car = await Car.findById(carID);
            if (!car) {
                return res.status(404).json({
                    success: false,
                    message: 'Car not found'
                });
            }
        }
        if (driverID) {
            const driver = await Driver.findById(driverID);
            if (!driver) {
                return res.status(404).json({
                    success: false,
                    message: 'Driver not found'
                });
            }
        }

        // Check if car license number already exists
        const existingCar = await Fleet.findOne({ carLicenseNumber });
        if (existingCar) {
            return res.status(400).json({
                success: false,
                message: 'Car with this license number already exists'
            });
        }

        const fleet = new Fleet({
            carID,
            driverID,
            carLicenseNumber,
            isBusyCar: isBusyCar || false,
            isActive: isActive !== undefined ? isActive : true
        });

        await fleet.save();

        // Populate references if needed
        await fleet.populate('carID driverID');

        res.status(201).json({
            success: true,
            message: 'Fleet created successfully',
            data: fleet
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});



// ==================== UPDATE ====================
// Update a fleet by ID
router.put('/api/fleets/:id', async (req, res) => {
    try {
        const { carID, driverID, carLicenseNumber, isBusyCar, isActive } = req.body;

        // Check if car license number is taken by another fleet
        if (carLicenseNumber) {
            const existingCar = await Fleet.findOne({
                carLicenseNumber,
                _id: { $ne: req.params.id }
            });
            if (existingCar) {
                return res.status(400).json({
                    success: false,
                    message: 'Car with this license number already exists'
                });
            }
        }

        const fleet = await Fleet.findByIdAndUpdate(
            req.params.id,
            {
                carID,
                driverID,
                carLicenseNumber,
                isBusyCar,
                isActive
            },
            {
                new: true,           // Return updated document
                runValidators: true, // Run schema validators
                context: 'query'
            }
        ).populate('carID driverID');

        if (!fleet) {
            return res.status(404).json({
                success: false,
                message: 'Fleet not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Fleet updated successfully',
            data: fleet
        });
    } catch (error) {
        if (error instanceof mongoose.Error.CastError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fleet ID format'
            });
        }
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});


// ==================== READ (GET ALL) ====================
// Get all fleets with pagination, filtering, and sorting
router.get('/api/fleets', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            isBusyCar,
            isActive,
            carID, // Added carID filter
            search, // Added search (for license number)
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build filter object
        const filter = {};
        if (isBusyCar !== undefined) filter.isBusyCar = isBusyCar === 'true';
        if (isActive !== undefined) filter.isActive = isActive === 'true';

        // Added carID filter logic
        if (carID) filter.carID = carID;

        // Added search (license number) filter logic using Regex
        if (search) {
            filter.carLicenseNumber = { $regex: search, $options: 'i' };
        }

        // Pagination
        const skip = (page - 1) * limit;

        // Sorting
        const sort = {};
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

        const fleets = await Fleet.find(filter)
            .populate('carID', 'name model year carName') // Specify fields to return
            .populate('driverID', 'driverName name email phone')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Fleet.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: fleets,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});


// ==================== SEPARATE FLEET SORT & STATUS APIS ====================

// 1. Sort vehicle by licenseNumber (Full list sorted by license, No IDs)
router.get('/api/fleets/sort-license', async (req, res) => {
    try {
        const fleets = await Fleet.find({}, 'carLicenseNumber isBusyCar isActive -_id')
            .populate('carID', 'carName model')
            .populate('driverID', 'name')
            .sort({ carLicenseNumber: 1 });

        res.status(200).json({ success: true, count: fleets.length, data: fleets });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Sort vehicle by isBusyCar (Full list sorted by busy status, No IDs)
router.get('/api/fleets/sort-busy', async (req, res) => {
    try {
        const fleets = await Fleet.find({}, 'carLicenseNumber isBusyCar isActive -_id')
            .populate('carID', 'carName model')
            .populate('driverID', 'name')
            .sort({ isBusyCar: -1 }); // Busy first

        res.status(200).json({ success: true, count: fleets.length, data: fleets });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 3. Status List / Is Busy or Not (Full list, No IDs)
router.get('/api/fleets/status-list', async (req, res) => {
    try {
        const fleets = await Fleet.find({}, 'carLicenseNumber isBusyCar isActive -_id')
            .populate('carID', 'carName model')
            .populate('driverID', 'name');

        res.status(200).json({ success: true, count: fleets.length, data: fleets });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== READ (GET SINGLE) ====================
// Get a single fleet by ID
router.get('/api/fleets/:id', async (req, res) => {
    try {
        const fleet = await Fleet.findById(req.params.id)
            .populate('carID')
            .populate('driverID');

        if (!fleet) {
            return res.status(404).json({
                success: false,
                message: 'Fleet not found'
            });
        }

        res.status(200).json({
            success: true,
            data: fleet
        });
    } catch (error) {
        if (error instanceof mongoose.Error.CastError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fleet ID format'
            });
        }
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});



// ==================== PATCH (PARTIAL UPDATE) ====================
// Partially update a fleet
router.patch('/api/fleets/:id', async (req, res) => {
    try {
        const updates = req.body;
        const allowedUpdates = ['carID', 'driverID', 'carLicenseNumber', 'isBusyCar', 'isActive'];
        const isValidOperation = Object.keys(updates).every(update => allowedUpdates.includes(update));

        if (!isValidOperation) {
            return res.status(400).json({
                success: false,
                message: 'Invalid updates!'
            });
        }

        const fleet = await Fleet.findById(req.params.id);

        if (!fleet) {
            return res.status(404).json({
                success: false,
                message: 'Fleet not found'
            });
        }

        // Apply updates
        Object.keys(updates).forEach(update => {
            fleet[update] = updates[update];
        });

        await fleet.save();
        await fleet.populate('carID driverID');

        res.status(200).json({
            success: true,
            message: 'Fleet updated successfully',
            data: fleet
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// ==================== DELETE ====================
// Delete a fleet by ID (Hard delete)
router.delete('/api/fleets/:id', async (req, res) => {
    try {
        const fleet = await Fleet.findByIdAndDelete(req.params.id);

        if (!fleet) {
            return res.status(404).json({
                success: false,
                message: 'Fleet not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Fleet deleted successfully',
            data: fleet
        });
    } catch (error) {
        if (error instanceof mongoose.Error.CastError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fleet ID format'
            });
        }
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ==================== SOFT DELETE ====================
// Soft delete (set isActive to false)
router.delete('/api/fleets/:id/soft', async (req, res) => {
    try {
        const fleet = await Fleet.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!fleet) {
            return res.status(404).json({
                success: false,
                message: 'Fleet not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Fleet soft deleted successfully',
            data: fleet
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ==================== RESTORE SOFT DELETED ====================
// Restore a soft-deleted fleet
router.patch('/api/fleets/:id/restore', async (req, res) => {
    try {
        const fleet = await Fleet.findByIdAndUpdate(
            req.params.id,
            { isActive: true },
            { new: true }
        );

        if (!fleet) {
            return res.status(404).json({
                success: false,
                message: 'Fleet not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Fleet restored successfully',
            data: fleet
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ==================== BULK OPERATIONS ====================
// Bulk create fleets
router.post('/api/fleets/bulk', async (req, res) => {
    try {
        const fleets = req.body.fleets;

        if (!Array.isArray(fleets)) {
            return res.status(400).json({
                success: false,
                message: 'fleets must be an array'
            });
        }

        const createdFleets = await Fleet.insertMany(fleets, { ordered: false });

        res.status(201).json({
            success: true,
            message: `${createdFleets.length} fleets created successfully`,
            data: createdFleets
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message,
            inserted: error.insertedDocs || []
        });
    }
});

// Bulk update fleet status
router.patch('/api/fleets/bulk/status', async (req, res) => {
    try {
        const { fleetIds, isBusyCar } = req.body;

        const result = await Fleet.updateMany(
            { _id: { $in: fleetIds } },
            { isBusyCar }
        );

        res.status(200).json({
            success: true,
            message: `${result.modifiedCount} fleets updated successfully`,
            data: result
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});








module.exports = router;