const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Fleet = require('../models/FleetModel');
const Car = require('../models/car_model');
const Driver = require('../models/driver_model');
const Booking = require('../models/booking_model');
const HourlyBooking = require('../models/hourlyBookingModel');
const AdminAssignCar = require('../models/assign_admin_car_model');
const FleetHistory = require('../models/FleetHistoryModel');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');
const { authenticateDriver } = require('../middleware/driverware');


// ==================== CREATE ====================
// Create a new fleet/car entry
router.post('/api/fleets',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
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
router.put('/api/fleets/:id',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
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




// ==================== SEPARATE FLEET SORT & STATUS APIS ====================

// 1. Sort vehicle by licenseNumber (Full list sorted by license, No IDs)
router.get('/api/fleets/sort-license',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
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
router.get('/api/fleets/sort-busy',
    authenticateToken,
    authorizeAdmin,

    async (req, res) => {
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
router.get('/api/fleets/status-list',
    authenticateToken,
    authorizeAdmin,

    async (req, res) => {
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
router.get('/api/fleets/:id',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
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

// ==================== READ (GET ALL) ====================
// Get all fleets with pagination, filtering, and sorting
router.get('/api/fleets',
    // authenticateToken,
    // authorizeAdmin,
    async (req, res) => {
        try {
            const {
                page = 1,
                limit = 10,
                isBusyCar,
                isActive,
                carID,
                search,
                lastTakenOutAt,
                lastReturnAt,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            const filter = {};
            if (isBusyCar !== undefined) filter.isBusyCar = isBusyCar === 'true';
            if (isActive !== undefined) filter.isActive = isActive === 'true';
            if (carID) filter.carID = carID;

            if (lastTakenOutAt === 'null' || lastTakenOutAt === '') {
                filter.lastTakenOutAt = null;
            } else if (lastTakenOutAt) {
                filter.lastTakenOutAt = lastTakenOutAt;
            }

            if (lastReturnAt === 'null' || lastReturnAt === '') {
                filter.lastReturnAt = null;
            } else if (lastReturnAt) {
                filter.lastReturnAt = lastReturnAt;
            }

            if (search) {
                filter.carLicenseNumber = { $regex: search, $options: 'i' };
            }

            const skip = (page - 1) * limit;
            const sort = {};
            sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

            let fleetsList = await Fleet.find(filter)
                .populate('carID', 'name model year carName')
                .populate('driverID', 'driverName name email phone')
                .sort(sort)
                .skip(skip)
                .limit(parseInt(limit))
                .lean();

            // Ensure lastTakenOutAt and lastReturnAt are present (as null if missing)
            const fleets = fleetsList.map(fleet => ({
                ...fleet,
                lastTakenOutAt: fleet.lastTakenOutAt || null,
                lastReturnAt: fleet.lastReturnAt || null
            }));

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




// ==================== PATCH (PARTIAL UPDATE) ====================
// Partially update a fleet
router.patch('/api/fleets/:id',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
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
router.delete('/api/fleets/:id',
    authenticateToken,
    authorizeAdmin,

    async (req, res) => {
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
router.delete('/api/fleets/:id/soft',
    authenticateToken,
    authorizeAdmin,

    async (req, res) => {
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
router.patch('/api/fleets/:id/restore',
    authenticateToken,
    authorizeAdmin,

    async (req, res) => {
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



// ==================== DRIVER OPERATIONS (TAKE OUT / RETURN) ====================

/**
 * @route   POST /api/fleets/take-out
 * @desc    Driver picks up a car (Starts a session)
 * @access  Private (Driver)
 */
router.post('/api/fleets/take-out', authenticateDriver, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { fleetID } = req.body;
        const driverID = req.driver.driverId;

        if (!fleetID) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'Fleet ID is required' });
        }

        const fleet = await Fleet.findOne({ _id: fleetID, isActive: true }).session(session);

        // 1. Check if driver has started working
        if (!req.driver.isWorkstarted) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'Please start your work status before taking out a vehicle' });
        }

        // 2. Check if driver already has another vehicle taken out
        const driverActiveFleet = await Fleet.findOne({
            driverID: driverID,
            isBusyCar: true
        }).session(session);

        if (driverActiveFleet) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: `You already have vehicle ${driverActiveFleet.carLicenseNumber} taken out. Please return it first.`
            });
        }

        if (!fleet) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ success: false, message: 'Fleet vehicle not found' });
        }

        if (fleet.isBusyCar) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'Vehicle is already taken out by another driver' });
        }

        // 1. Create Fleet History record
        const historyEntry = new FleetHistory({
            fleetID: fleet._id,
            driverID: driverID,
            takenOutAt: new Date()
        });
        await historyEntry.save({ session });

        // 2. Update Fleet live state
        fleet.isBusyCar = true;
        fleet.driverID = driverID;
        fleet.lastTakenOutAt = historyEntry.takenOutAt;
        fleet.activeHistoryID = historyEntry._id;
        await fleet.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            success: true,
            message: 'Vehicle taken out successfully',
            data: {
                carLicenseNumber: fleet.carLicenseNumber,
                takenOutAt: fleet.lastTakenOutAt,
                sessionID: fleet.activeHistoryID
            }
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Take-out error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   POST /api/fleets/return
 * @desc    Driver returns the car (Ends a session)
 * @access  Private (Driver)
 */
router.post('/api/fleets/return', authenticateDriver, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const driverID = req.driver.driverId;

        // Automatically find the vehicle currently taken out by this driver
        const fleet = await Fleet.findOne({ 
            driverID: driverID, 
            isBusyCar: true 
        }).session(session);

        if (!fleet) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({ 
                success: false, 
                message: 'No active vehicle session found for this driver' 
            });
        }

        if (!fleet.activeHistoryID) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({ success: false, message: 'No active session found for this vehicle' });
        }

        const now = new Date();

        // 1. Update Fleet History record using the activeHistoryID
        const historyEntry = await FleetHistory.findById(fleet.activeHistoryID).session(session);
        if (historyEntry) {
            historyEntry.returnedAt = now;
            await historyEntry.save({ session });
        }

        // 2. Update Fleet live state
        fleet.isBusyCar = false;
        fleet.lastReturnAt = now;
        fleet.activeHistoryID = null;
        await fleet.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            success: true,
            message: 'Vehicle returned successfully',
            data: {
                carLicenseNumber: fleet.carLicenseNumber,
                returnedAt: fleet.lastReturnAt
            }
        });

    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Return error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});





module.exports = router;