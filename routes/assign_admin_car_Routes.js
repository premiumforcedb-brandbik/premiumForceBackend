// routes/adminAssignDriverRoutes.js
const express = require('express');
const router = express.Router();
const AdminAssignCar = require('../models/assign_admin_car_model');
const CarFleet = require('../models/FleetModel');
const Booking = require('../models/booking_model');

const HourlyBooking = require('../models/hourlyBookingModel');
const { notifyDriver, notifyUser } = require('../fcm');



const Admin = require('../models/users_model');

const { authenticateToken,
    authorizeAdmin,
    authorizeRoles,
    authorizeAny,
    // New refresh token functions
    generateRefreshToken,
    authenticateRefreshToken,
    refreshAccessToken, } = require('../middleware/adminmiddleware');

// @desc    Assign a driver to admin
// @route   POST /api/admin/assign-driver
// @access  Private (Admin only)
// ============= ASSIGN DRIVER (Regular Booking) =============
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        console.log('========== ASSIGN DRIVER DEBUG ==========');
        console.log('1. Request body:', req.body);

        const { vehicleID, bookingID } = req.body;

        // Validate required fields
        if (!vehicleID || !bookingID) {

            return res.status(400).json({
                success: false,
                message: 'vehicleID and bookingID are required'
            });
        }



        // Get admin ID from token
        const adminID = req.user?.adminId || req.user?.id || req.user?._id;

        if (!adminID) {
            return res.status(401).json({
                success: false,
                message: 'Authentication failed - admin not found'
            });
        }

        // Check if driver exists
        const car = await CarFleet.findOne({ carID: vehicleID });
        if (!car) {
            return res.status(404).json({
                success: false,
                message: 'Car not found'
            });
        }

        // Check if driver is already busy
        if (car.isBusyCar) {
            return res.status(400).json({
                success: false,
                message: 'Car is currently busy with another booking',
                driver: {
                    id: car._id,
                    licenseNumber: car.carLicenseNumber,
                    currentBookingId: car.currentBookingId
                }
            });
        }

        // Check if booking exists
        const booking = await Booking.findById(bookingID);
        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }

        console.log('Booking status:', booking.bookingStatus);

        console.log("The booking 108", booking.bookingStatus);

        console.log(booking.bookingStatus);


        // return;

        // Check for existing assignment
        const existingAssignment = await AdminAssignCar.findOne({
            vehicleID: vehicleID,
            bookingID: bookingID
        });


        if (existingAssignment) {

            // await notifyUser(
            //     String(booking.customerID).trim(),
            //     'Driver Assigned',
            //     `Driver has been assigned to your booking.`,
            //     {
            //         type: 'booking_assigned',
            //         bookingId: existingAssignment._id.toString(),
            //         status: existingAssignment.status
            //     }
            // );




            // await notifyDriver(
            //     String(driverID).trim(),
            //     '📅 Already Assigned',
            //     `You have been already assigned this booking.`,
            //     {
            //         type: 'booking_assigned',
            //         bookingId: existingAssignment._id.toString(),
            //         status: existingAssignment.status
            //     }
            // );

            return res.status(400).json({
                success: false,
                message: 'This car is already assigned to this booking',
                alreadyAssigned: true
            });
        }

        // Extract booking date
        const bookingDateStr = booking.arrival ? new Date(booking.arrival).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

        // Create new assignment
        const assignment = new AdminAssignCar({
            adminID: adminID.toString(),
            vehicleID: vehicleID,
            bookingID: bookingID,
            bookingDate: bookingDateStr,
            assignedAt: new Date()
        });

        await assignment.save();


        // Update booking with driver and status
        const updatedBooking = await Booking.findByIdAndUpdate(
            bookingID,
            {
                driverID: car.driverID,
                bookingStatus: 'assigned', // Change status to assigned when driver assigned
                driverAssignedAt: new Date(),
                updatedAt: new Date()
            },
            { new: true }
        );

        // Update car as busy
        car.isBusyCar = true;
        await car.save();

        // Fetch additional related data
        const [bookingData, adminData] = await Promise.all([
            Booking.findById(bookingID).select('bookingStatus driverAssignedAt customerID driverID'),
            Admin.findById(adminID).select('username email'),
        ]);

        if (car.driverID) {
            await notifyDriver(
                String(car.driverID).trim(),
                '📅 Booking Assigned!',
                `Booking assigned a new booking has been to you`,
                {
                    type: 'booking_assigned',
                    bookingId: updatedBooking._id.toString(),
                    status: updatedBooking.bookingStatus
                }
            );
        }

        await notifyUser(
            String(booking.customerID).trim(),
            'Driver Assigned',
            `A Driver has been assigned to your booking.`,
            {
                type: 'booking_assigned',
                bookingId: updatedBooking._id.toString(),
                status: updatedBooking.bookingStatus
            }
        );

        res.status(201).json({
            success: true,
            message: 'CarFleet assigned successfully',
            data: {
                assignment: {
                    id: assignment._id,
                    carFleet: car,
                    booking: bookingData,
                    assignedBy: adminData,
                    status: assignment.status
                },
                driverStatus: {
                    isBusy: car.isBusyCar,
                    // currentBookingId: car.currentBookingId
                },
                bookingUpdate: {
                    id: updatedBooking._id,
                    bookingStatus: updatedBooking.bookingStatus,
                    driverAssignedAt: updatedBooking.driverAssignedAt
                }
            }
        });

    } catch (error) {
        console.error('❌ Assign driver error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'This assignment already exists',
                error: 'DUPLICATE_ASSIGNMENT'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error assigning driver',
            error: error.message
        });
    }
});





// POST /api/assign-car/HourlyBooking - Assign driver to hourly booking
router.post('/HourlyBooking', authenticateToken, authorizeAdmin,
    async (req, res) => {
        try {
            console.log('========== ASSIGN DRIVER DEBUG ==========');
            console.log('1. Request body:', req.body);

            const { vehicleID, bookingID } = req.body;

            // Validate required fields
            if (!vehicleID || !bookingID) {
                return res.status(400).json({
                    success: false,
                    message: 'vehicleID and bookingID are required'
                });
            }

            // Get admin ID from token
            const adminID = req.user?.adminId || req.user?.id || req.user?._id;

            if (!adminID) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication failed - admin not found'
                });
            }

            // Check if driver exists
            const car = await CarFleet.findOne({ carID: vehicleID });
            if (!car) {
                return res.status(404).json({
                    success: false,
                    message: 'Car not found'
                });
            }

            // Check if driver is already busy
            if (car.isBusyCar) {
                return res.status(400).json({
                    success: false,
                    message: 'Car is currently busy with another booking',
                    car: {
                        id: car._id,
                        licenseNumber: car.carLicenseNumber,
                        currentBookingId: car.currentBookingId
                    }
                });
            }


            // Check if booking exists (using HourlyBooking model)
            const booking = await HourlyBooking.findById(bookingID);
            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Hourly booking not found'
                });
            }

            console.log('Current booking status:', booking.bookingStatus);

            // Check if booking can be assigned (only pending or confirmed bookings can be assigned)
            // const allowedStatuses = ['assigned'];
            // if (!allowedStatuses.includes(booking.bookingStatus)) {
            //   return res.status(400).json({
            //     success: false,
            //     message: `Cannot assign driver. Booking is already ${booking.bookingStatus}`,
            //     currentStatus: booking.bookingStatus,
            //     allowedStatuses: allowedStatuses
            //   });
            // }

            // Check if driver is already assigned to this booking
            const existingAssignment = await AdminAssignCar.findOne({
                vehicleID: vehicleID,
                bookingID: bookingID
            });

            if (existingAssignment) {
                return res.status(400).json({
                    success: false,
                    message: 'This car is already assigned to this booking',
                    alreadyAssigned: true,
                    assignmentId: existingAssignment._id
                });
            }

            // Check if booking already has a driver assigned
            if (booking.driverID) {
                return res.status(400).json({
                    success: false,
                    message: 'Booking already has a driver assigned',
                    currentDriverId: booking.driverID
                });
            }

            // Extract booking date
            const bookingDateStr = booking.pickupDateTime ? new Date(booking.pickupDateTime).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

            // Create new assignment
            const assignment = new AdminAssignCar({
                adminID: adminID.toString(),
                vehicleID: vehicleID,
                bookingID: bookingID,
                bookingDate: bookingDateStr,
                assignedAt: new Date()
            });

            await assignment.save();

            // Update booking with driver and status
            const updatedBooking = await HourlyBooking.findByIdAndUpdate(
                bookingID,
                {
                    driverID: car.driverID,
                    bookingStatus: 'assigned', // Change status to assigned when driver assigned
                    updatedAt: new Date()
                },
                { new: true }
            );


            // Update car as busy
            car.isBusyCar = true;
            await car.save();

            // Fetch related data for response
            const [bookingData, adminData] = await Promise.all([
                HourlyBooking.findById(bookingID).select('bookingStatus updatedAt driverID customerID'),
                Admin.findById(adminID).select('username email')
            ]);

            if (car.driverID) {
                await notifyDriver(
                    String(car.driverID).trim(),
                    '📅 Hourly Booking Assigned!',
                    `You have been assigned to an hourly booking.`,
                    {
                        type: 'hourly_booking_assigned',
                        bookingId: updatedBooking._id.toString(),
                        status: updatedBooking.bookingStatus
                    }
                );
            }

            await notifyUser(
                String(booking.customerID).trim(),
                'Driver Assigned',
                `A driver has been assigned to your hourly booking.`,
                {
                    type: 'hourly_booking_assigned',
                    bookingId: updatedBooking._id.toString(),
                    status: updatedBooking.bookingStatus
                }
            );

            // // Send notification to customer


            res.status(201).json({
                success: true,
                message: 'Car assigned successfully',
                data: {
                    assignment: {
                        id: assignment._id,
                        carData: car,
                        booking: {
                            _id: updatedBooking._id,
                            pickupAddress: updatedBooking.pickupAdddress,
                            hours: updatedBooking.hours,
                            charge: updatedBooking.charge,
                            bookingStatus: updatedBooking.bookingStatus,
                        },
                        assignedBy: adminData,
                        status: assignment.status
                    },
                    carStatus: {
                        isBusy: car.isBusyCar,
                    },
                    bookingUpdate: {
                        id: updatedBooking._id,
                        bookingStatus: updatedBooking.bookingStatus,
                        driverID: updatedBooking.driverID
                    }
                }
            });


        } catch (error) {
            console.error('❌ Assign driver error:', error);

            if (error.code === 11000) {
                return res.status(400).json({
                    success: false,
                    message: 'This assignment already exists',
                    error: 'DUPLICATE_ASSIGNMENT'
                });
            }

            res.status(500).json({
                success: false,
                message: 'Error assigning driver',
                error: error.message
            });
        }
    });




// @desc    Check if a car is already assigned to a booking
// @route   GET /api/assign-car/check-assignment
// @access  Private (Admin only)
// router.get('/check-assignment',

// Updated Check Assignment Route
router.get('/check-assignment',

    //  authenticateToken, authorizeAdmin,
    async (req, res) => {
        try {
            // Support both query parameters (standard for GET) and body
            const vehicleID = req.query.vehicleID || req.body.vehicleID;
            const bookingID = req.query.bookingID || req.body.bookingID;
            const bookingDate = req.query.bookingDate || req.body.bookingDate;

            console.log('Checking assignment for:', { vehicleID, bookingID, bookingDate });

            if (!vehicleID) {
                return res.status(400).json({
                    success: false,
                    message: 'vehicleID is required'
                });
            }

            // Build query
            const query = { vehicleID: vehicleID.toString().trim() };

            if (bookingID) query.bookingID = bookingID.toString().trim();
            if (bookingDate) query.bookingDate = bookingDate.toString().trim();

            const assignment = await AdminAssignCar.findOne(query);

            if (assignment) {
                return res.status(200).json({
                    success: true,
                    isAssigned: true,
                    message: `This car is already assigned ${bookingDate ? 'on ' + bookingDate : 'to this booking'}`,
                    data: assignment
                });
            }


            return res.status(200).json({
                success: true,
                isAssigned: false,
                message: 'This car is available for this criteria'
            });

        } catch (error) {
            console.error('❌ Check assignment error:', error);
            res.status(500).json({
                success: false,
                message: 'Error checking assignment',
                error: error.message
            });
        }
    });




// @desc    Get all assignments for an admin
// @route   GET /api/admin/assignments
// @access  Private (Admin only)
router.get('/assignments', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const adminID = req.admin._id;
        const { status, page = 1, limit = 10 } = req.query;

        const query = { adminID };
        if (status) {
            query.status = status;
        }

        const assignments = await AdminAssignCar.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await AdminAssignCar.countDocuments(query);

        res.status(200).json({
            success: true,
            data: assignments,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching assignments',
            error: error.message
        });
    }
});

// @desc    Update assignment status
// @route   PUT /api/admin/assignments/:id
// @access  Private (Admin only)
router.put('/assignments/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        const adminID = req.admin._id;

        const assignment = await AdminAssignCar.findOne({
            _id: id,
            adminID
        });

        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: 'Assignment not found'
            });
        }

        // Update fields
        if (status) assignment.status = status;
        if (notes !== undefined) assignment.notes = notes;

        await assignment.save();

        res.status(200).json({
            success: true,
            message: 'Assignment updated successfully',
            data: assignment
        });

    } catch (error) {
        console.error('Update assignment error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating assignment',
            error: error.message
        });
    }
});

// @desc    Unassign/remove driver
// @route   DELETE /api/admin/assignments/:id
// @access  Private (Admin only)
router.delete('/assignments/:id', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const adminID = req.admin._id;

        const assignment = await AdminAssignCar.findOneAndDelete({
            _id: id,
            adminID
        });

        if (!assignment) {
            return res.status(404).json({
                success: false,
                message: 'Assignment not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Car unassigned successfully'
        });

    } catch (error) {
        console.error('Unassign driver error:', error);
        res.status(500).json({
            success: false,
            message: 'Error unassigning driver',
            error: error.message
        });
    }
});

// @desc    Get all available cars for a specific date
// @route   GET /api/assign-car/available-cars
// @access  Private (Admin only)
router.get('/available-drivers', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { date } = req.query; // YYYY-MM-DD

        let query = { isActive: true };

        // If specific date is provided, exclude cars already assigned on that date
        if (date) {
            const assignedVehicleIDs = await AdminAssignCar.find({
                bookingDate: date
            }).distinct('vehicleID');

            query._id = { $nin: assignedVehicleIDs };
        } else {
            // If no date, just return cars that are not currently busy
            query.isBusyCar = false;
        }

        const availableCars = await CarFleet.find(query);

        res.status(200).json({
            success: true,
            count: availableCars.length,
            date: date || 'current_status',
            data: availableCars
        });

    } catch (error) {
        console.error('Get available cars error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching available cars',
            error: error.message
        });
    }
});




module.exports = router;