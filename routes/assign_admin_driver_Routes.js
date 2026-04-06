// routes/adminAssignDriverRoutes.js
const express = require('express');
const router = express.Router();
const AdminAssignDriver = require('../models/assign_admin_driver_model');
const Driver = require('../models/driver_model');
const Booking = require('../models/booking_model');

const HourlyBooking = require('../models/hourlyBookingModel');
const { notifyDriver } = require('../fcm');



const Customer = require('../models/users_model');
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
router.post('/assign-driver', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    console.log('========== ASSIGN DRIVER DEBUG ==========');
    console.log('1. Request body:', req.body);

    const { driverID, bookingID } = req.body;

    // Validate required fields
    if (!driverID || !bookingID) {
      return res.status(400).json({
        success: false,
        message: 'driverID, bookingID, and customerID are required'
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
    const driver = await Driver.findById(driverID);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if driver is already busy
    if (driver.isBusy) {
      return res.status(400).json({
        success: false,
        message: 'Driver is currently busy with another booking',
        driver: {
          id: driver._id,
          name: driver.driverName,
          currentBookingId: driver.currentBookingId
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

    // // Check if booking is already assigned or completed
    // if (booking.bookingStatus !== 'pending' && booking.bookingStatus !== 'completed') {
    //   return res.status(400).json({
    //     success: false,
    //     message: `Booking is already ${booking.bookingStatus}. Cannot assign driver.`
    //   });
    // }

    // conosle.log(booking.bookingStatus);
    // Check if booking is already assigned or in progress
    //   if (booking.bookingStatus !== 'pending' ) {
    //     if(booking.bookingStatus !== 'completed'){
    //  return res.status(400).json({
    //       success: false,
    //       message: `Booking is already ${booking.bookingStatus}. Cannot assign driver.`
    //     });

    //     }
    //   }
    console.log("The booking 108", booking.bookingStatus);

    console.log(booking.bookingStatus);



    // return;

    // Check for existing assignment
    const existingAssignment = await AdminAssignDriver.findOne({
      driverID: driverID,
      bookingID: bookingID,
    });


    if (existingAssignment) {
      await notifyDriver(
        String(driverID).trim(),
        '📅 Already Assigned',
        `You have been already assigned this booking.`,
        {
          type: 'booking_assigned',
          bookingId: existingAssignment._id.toString(),
          status: existingAssignment.status
        }


      );
      return res.status(400).json({
        success: false,
        message: 'This driver is already assigned to this booking',
        alreadyAssigned: true
      });
    }

    // Create new assignment
    const assignment = new AdminAssignDriver({
      adminID: adminID.toString(),
      driverID,
      bookingID,
      status: 'active'
    });

    await assignment.save();


    // Update booking with driver and status
    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingID,
      {
        driverID: driverID,
        bookingStatus: 'assigned', // Change status to assigned when driver assigned
        driverAssignedAt: new Date(),
        updatedAt: new Date()
      },
      { new: true }
    );

    // Update driver as busy
    // await driver.setBusy(bookingID);

    // Fetch related data
    const [driverData, bookingData, adminData, customerData] = await Promise.all([
      Driver.findById(driverID).select('driverName phoneNumber email isBusy currentBookingId'),
      Booking.findById(bookingID).select('bookingStatus driverAssignedAt customerID driverID'),
      Admin.findById(adminID).select('name email'),
      // Customer.findById(customerID).select('name email phone address')
    ]);
    await notifyDriver(
      String(driverID).trim(),
      '📅 Driver Assigned',
      `You have been assigned a new booking. Please complete or cancel it before creating a new one.`,
      {
        type: 'booking_assigned',
        bookingId: updatedBooking._id.toString(),
        status: updatedBooking.bookingStatus
      }
    );


    res.status(201).json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        assignment: {
          id: assignment._id,
          driver: driverData,
          booking: bookingData,
          customer: customerData,
          assignedBy: adminData,
          status: assignment.status
        },
        driverStatus: {
          isBusy: driver.isBusy,
          currentBookingId: driver.currentBookingId
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





// POST /api/assign-driver/HourlyBooking - Assign driver to hourly booking
router.post('/assign-driver/HourlyBooking', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    console.log('========== ASSIGN DRIVER DEBUG ==========');
    console.log('1. Request body:', req.body);

    const { driverID, bookingID } = req.body;

    // Validate required fields
    if (!driverID || !bookingID) {
      return res.status(400).json({
        success: false,
        message: 'driverID and bookingID are required'
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
    const driver = await Driver.findById(driverID);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if driver is already busy
    if (driver.isBusy) {
      return res.status(400).json({
        success: false,
        message: 'Driver is currently busy with another booking',
        driver: {
          id: driver._id,
          name: driver.driverName,
          currentBookingId: driver.currentBookingId
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
    const existingAssignment = await AdminAssignDriver.findOne({
      driverID: driverID,
      bookingID: bookingID,
      status: 'active'
    });

    if (existingAssignment) {
      return res.status(400).json({
        success: false,
        message: 'This driver is already assigned to this booking',
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

    // Create new assignment
    const assignment = new AdminAssignDriver({
      adminID: adminID.toString(),
      driverID: driverID,
      bookingID: bookingID,
      bookingType: 'hourly', // Specify booking type
      status: 'active'
    });

    await assignment.save();

    // Update booking with driver and status
    const updatedBooking = await HourlyBooking.findByIdAndUpdate(
      bookingID,
      {
        driverID: driverID,
        bookingStatus: 'assigned', // Change status to assigned when driver assigned
        updatedAt: new Date()
      },
      { new: true }
    );


    // Update driver as busy
    // await driver.setBusy(bookingID);

    // Fetch related data for response
    const [driverData, adminData] = await Promise.all([
      Driver.findById(driverID).select('driverName phoneNumber email isBusy currentBookingId rating totalTrips'),
      Admin.findById(adminID).select('name email')
    ]);

    // Send notification to customer
    try {
      await notifyUser(
        updatedBooking.customerID,
        '🚗 Driver Assigned',
        `A driver has been assigned to your hourly booking. Driver: ${driverData.driverName}. Status: Confirmed.`,
        {
          type: 'driver_assigned',
          bookingId: updatedBooking._id.toString(),
          bookingType: 'hourly',
          driverId: driverID,
          driverName: driverData.driverName,
          status: updatedBooking.bookingStatus
        }
      );
    } catch (notifyError) {
      console.error('Notification error:', notifyError);
    }

    // Send notification to driver
    try {
      await notifyDriver(
        driverID,
        '🚗 New Booking Assigned',
        `You have been assigned to a new hourly booking. Booking ID: ${bookingID}`,
        {
          type: 'booking_assigned',
          bookingId: updatedBooking._id.toString(),
          bookingType: 'hourly',
          customerId: updatedBooking.customerID,
          pickupAddress: updatedBooking.pickupAdddress
        }
      );
    } catch (notifyError) {
      console.error('Driver notification error:', notifyError);
    }

    res.status(201).json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        assignment: {
          id: assignment._id,
          driver: driverData,
          booking: {
            _id: updatedBooking._id,
            carName: updatedBooking.carName,
            pickupAddress: updatedBooking.pickupAdddress,
            hours: updatedBooking.hours,
            charge: updatedBooking.charge,
            bookingStatus: updatedBooking.bookingStatus,
            driverAssignedAt: updatedBooking.driverAssignedAt
          },
          assignedBy: adminData,
          status: assignment.status
        },
        driverStatus: {
          isBusy: driver.isBusy,
          currentBookingId: driver.currentBookingId
        },
        bookingUpdate: {
          id: updatedBooking._id,
          bookingStatus: updatedBooking.bookingStatus,
          driverAssignedAt: updatedBooking.driverAssignedAt,
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






// // ============= ASSIGN DRIVER (Hourly Booking) =============
// router.post('/assign-driver/HourlyBooking', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     console.log('========== ASSIGN DRIVER (HOURLY) DEBUG ==========');
//     console.log('1. Request body:', req.body);

//     const { driverID, bookingID, customerID, assignedAt } = req.body;

//     // Validate required fields
//     if (!driverID) {
//       return res.status(400).json({
//         success: false,
//         message: 'Driver ID required'
//       });
//     }

//     if (!bookingID) {
//       return res.status(400).json({
//         success: false,
//         message: 'Booking ID required'
//       });
//     }

//     if (!customerID) {
//       return res.status(400).json({
//         success: false,
//         message: 'Customer ID required'
//       });
//     }

//     // Validate assignedAt is provided
//     if (!assignedAt) {
//       return res.status(400).json({
//         success: false,
//         message: 'Assigned date and time (assignedAt) is required'
//       });
//     }

//     // Validate assignedAt format
//     const assignedDate = new Date(assignedAt);
//     if (isNaN(assignedDate.getTime())) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid assignedAt format. Please use valid date format (e.g., "2024-03-23T10:30:00Z")'
//       });
//     }

//     // Get admin ID
//     const adminID = req.user?.adminId || req.user?.id || req.user?._id;
//     console.log('2. Admin ID:', adminID);
//     console.log('3. Assigned date:', assignedDate);

//     if (!adminID) {
//       return res.status(401).json({
//         success: false,
//         message: 'Authentication failed - admin not found'
//       });
//     }

//     // Check if driver exists
//     const driver = await Driver.findById(driverID);
//     if (!driver) {
//       return res.status(404).json({
//         success: false,
//         message: 'Driver not found'
//       });
//     }

//     // Check if hourly booking exists
//     const booking = await HourlyBooking.findById(bookingID);
//     if (!booking) {
//       return res.status(404).json({
//         success: false,
//         message: 'Hourly booking not found'
//       });
//     }

//     // Check if customer exists
//     const customer = await Customer.findById(customerID);
//     if (!customer) {
//       return res.status(404).json({
//         success: false,
//         message: 'Customer not found'
//       });
//     }

//     // Check for existing assignment
//     const existingAssignment = await AdminAssignDriver.findOne({
//       driverID: driverID,
//       bookingID: bookingID
//     });

//     if (existingAssignment) {
//       return res.status(400).json({
//         success: false,
//         message: 'This driver is already assigned to this booking',
//         alreadyAssigned: true,
//         data: {
//           assignment: existingAssignment
//         }
//       });
//     }

//     // Check if booking already assigned to another driver
//     if (booking.driverID && booking.driverID.toString() !== driverID) {
//       return res.status(400).json({
//         success: false,
//         message: 'This booking is already assigned to another driver'
//       });
//     }

//     // Create new assignment with provided assignedAt
//     const assignment = new AdminAssignDriver({
//       adminID: adminID.toString(),
//       driverID,
//       bookingID,
//       customerID,
//       assignedAt: assignedDate, // Using provided date
//       status: 'active'
//     });

//     await assignment.save();
//     console.log('Assignment saved with ID:', assignment._id);
//     console.log('Assigned at:', assignment.assignedAt);

//     // Update hourly booking
//     const updatedBooking = await HourlyBooking.findByIdAndUpdate(
//       bookingID,
//       {
//         $set: {
//           customerID: customerID,
//           driverID: driverID,
//           bookingStatus: 'assigned'
//         }
//       },
//       { new: true }
//     );

//     // Fetch related data
//     const [driverData, bookingData, adminData, customerData] = await Promise.all([
//       Driver.findById(driverID).select('driverName phoneNumber email vehicleName vehicleNumber'),
//       HourlyBooking.findById(bookingID).select('hours pickupAdddress dropOffAddress bookingStatus carName'),
//       Admin.findById(adminID).select('name email'),
//       Customer.findById(customerID).select('name email phone address')
//     ]);

//     res.status(201).json({
//       success: true,
//       message: 'Driver assigned successfully',
//       data: {
//         assignment: {
//           id: assignment._id,
//           driver: driverData,
//           booking: bookingData,
//           customer: customerData,
//           assignedBy: adminData,
//           assignedAt: assignment.assignedAt,
//           status: assignment.status
//         },
//         bookingUpdate: updatedBooking
//       }
//     });

//   } catch (error) {
//     console.error('❌ Assign driver error:', error);

//     if (error.code === 11000) {
//       return res.status(400).json({
//         success: false,
//         message: 'This assignment already exists',
//         error: 'DUPLICATE_ASSIGNMENT'
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Error assigning driver',
//       error: error.message
//     });
//   }
// });






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

    const assignments = await AdminAssignDriver.find(query)
      .populate('driverID', 'driverName phoneNumber email vehicleName vehicleImage')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await AdminAssignDriver.countDocuments(query);

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

    const assignment = await AdminAssignDriver.findOne({
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

    await assignment.populate([
      { path: 'driverID', select: 'driverName phoneNumber email' },
      { path: 'adminID', select: 'name email' }
    ]);

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

    const assignment = await AdminAssignDriver.findOneAndDelete({
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
      message: 'Driver unassigned successfully'
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

// @desc    Get all unassigned drivers (available for assignment)
// @route   GET /api/admin/available-drivers
// @access  Private (Admin only)
router.get('/available-drivers', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    // Find all drivers that are not actively assigned
    const activeAssignments = await AdminAssignDriver.find({
      status: 'active'
    }).distinct('driverID');

    const availableDrivers = await Driver.find({
      _id: { $nin: activeAssignments },
      isActive: true
    }).select('driverName phoneNumber email vehicleName vehicleImage');

    res.status(200).json({
      success: true,
      data: availableDrivers
    });

  } catch (error) {
    console.error('Get available drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available drivers',
      error: error.message
    });
  }
});



module.exports = router;