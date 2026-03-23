// routes/adminAssignDriverRoutes.js
const express = require('express');
const router = express.Router();
const AdminAssignDriver = require('../models/assign_admin_driver_model');
const Driver = require('../models/driver_model');
const Booking = require('../models/booking_model');

const HourlyBooking = require('../models/hourlyBookingModel');



const Customer = require('../models/users_model');
const Admin = require('../models/users_model');
const {   authenticateToken,
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
router.post('/assign-driver', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
   
    console.log('========== ASSIGN DRIVER DEBUG ==========');
    console.log('1. Request body:', req.body);
    console.log('2. req.admin:', req.admin);
    console.log('3. req.user:', req.user.adminId);
    
    const { driverID, bookingID, customerID } = req.body;

    // Check if admin exists in request
    if (!req.user.adminId) {
      console.log('5. ERROR: req.user is undefined or missing userId!');
      return res.status(401).json({
        success: false,
        message: 'Authentication failed - admin not found in request'
      });
    }

    console.log('6. Admin ID from token:', req.user.adminId);
    console.log('7. Admin full object:', JSON.stringify(req.user, null, 2));

    const adminID = req.user.adminId;

    // Validate required fields
    if (!driverID) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID required'
      });
    }
    
    if (!bookingID) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID required'
      });
    }

    if (!customerID) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID required'
      });
    }

    // Check if driver exists
    console.log('8. Looking for driver with ID:', driverID);
    const driver = await Driver.findById(driverID);
    console.log('9. Driver found:', driver ? 'Yes' : 'No');
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if booking exists
    const booking = await Booking.findById(bookingID);
    console.log('9. Booking found:', booking);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    
    console.log('Booking found:', booking.bookingStatus);

    // Check if customer exists
    const customer = await Customer.findById(customerID);
    console.log('9. Customer found:', customer);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    console.log('Customer found:', customer);

    // CHECK FOR EXISTING ASSIGNMENT
    console.log('10. Checking existing assignments for driver:', driverID, 'and booking:',
       bookingID, 'and customer:', customerID);
    
    const existingAssignment = await AdminAssignDriver.findOne({
      driverID: driverID,
      bookingID: bookingID,
      customerID: customerID,
    });

    console.log('11. Existing assignment:', existingAssignment);
console.log('Booking status:', booking.bookingStatus);

console.log('Existing assignment status:', existingAssignment ? existingAssignment.status : 'N/A');
console.log('Booking status:', booking.bookingStatus!='pending' ? "Not Pending" : 'N/A');

// return;

    // IF ASSIGNMENT ALREADY EXISTS
    if ((existingAssignment && booking.bookingStatus=='assigned')||booking.bookingStatus!='completed' ) {
      console.log('⚠️ DUPLICATE ASSIGNMENT ATTEMPT: Driver already assigned to this booking');
      
      const assignedAdmin = await Admin.findById(existingAssignment.adminID).select('name email');
      const assignedDriver = await Driver.findById(existingAssignment.driverID).select('driverName phoneNumber email');
      const assignedBooking = await Booking.findById(existingAssignment.bookingID).select('bookingDate status pickupLocation dropLocation');
      
      const adminName = assignedAdmin ? assignedAdmin.name || assignedAdmin.email || 'Unknown Admin' : 'Unknown Admin';
      

      return res.status(400).json({
        success: false,
        message: 'This driver is already assigned to this booking',
        error: 'DUPLICATE_ASSIGNMENT',
        alreadyAssigned: true,
        data: {
          assignment: {
            id: existingAssignment._id,
            driver: {
              id: existingAssignment.driverID,
              name: assignedDriver?.driverName || driver.driverName || 'Unknown Driver',
              phone: assignedDriver?.phoneNumber || driver.phoneNumber
            },
            booking: {
              id: existingAssignment.bookingID,
              date: assignedBooking?.bookingDate || booking.bookingDate,
              status: assignedBooking?.status || booking.status,
              pickupLocation: assignedBooking?.pickupLocation,
              dropLocation: assignedBooking?.dropLocation
            },
            assignedTo: {
              id: existingAssignment.adminID,
              name: adminName,
              email: assignedAdmin?.email
            },
            assignedAt: existingAssignment.assignedAt || existingAssignment.createdAt,
            status: existingAssignment.status
          }
        },
        suggestion: 'To change the assignment, please update or delete the existing assignment first'
      });
    }

    // NO EXISTING ASSIGNMENT - CREATE NEW ONE
    console.log('12. No existing assignment found. Creating new assignment with adminID:', adminID);
    
    const assignmentData = {
      adminID: adminID.toString(),
      driverID,
      bookingID,
      // customerID,
      status: 'active',
      assignedAt: new Date(),
      createdAt: new Date()
    };
    
    assignmentData.customerID = customerID;
    
    const assignment = new AdminAssignDriver(assignmentData);

    await assignment.save();
    console.log('13. Assignment saved with ID:', assignment._id);

    // UPDATE THE BOOKING
    console.log('14. Updating booking with customerID and driverID');
    console.log('Booking ID:', bookingID);
    console.log('Customer ID:', customerID);
    console.log('Driver ID:', driverID);


    
    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingID,
      {
        $set: {
          customerID: customerID,
          driverID: driverID,
          driverAssignedAt: new Date(),
          bookingStatus: 'assigned'
        }
      },
      { new: true }
    ).select('bookingDate status pickupLocation dropLocation customerName customerID driverID');

    console.log('15. Booking updated successfully:', updatedBooking ? 'Yes' : 'No');

    // FIXED: Changed from AdminAssignDoctor to AdminAssignDriver
    const savedAssignment = await AdminAssignDriver.findById(assignment._id);
    
    // Fetch related data manually
    const [driverData, bookingData, adminData, customerData] = await Promise.all([
      Driver.findById(savedAssignment.driverID).select('driverName phoneNumber email vehicleName vehicleNumber'),
      Booking.findById(savedAssignment.bookingID).select('bookingDate status pickupLocation dropLocation customerName customerID driverID'),
      Admin.findById(savedAssignment.adminID).select('name email'),
      Customer.findById(customerID).select('name email phone address')
    ]);

    console.log('16. Assignment data fetched successfully');
    console.log('========== END DEBUG ==========');

    // SUCCESS RESPONSE
    res.status(201).json({
      success: true,
      message: 'Driver assigned successfully and booking updated',
      data: {
        assignment: {
          id: savedAssignment._id,
          driver: driverData,
          booking: bookingData,
          customer: customerData,
          assignedBy: adminData,
          assignedAt: savedAssignment.assignedAt,
          status: savedAssignment.status
        },
        bookingUpdate: {
          id: updatedBooking._id,
          customerID: updatedBooking.customerID,
          driverID: updatedBooking.driverID,
          status: updatedBooking.bookingStatus
        }
      }
    });

  } catch (error) {
    console.error('❌ Assign driver error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This driver is already assigned to this booking',
        error: 'DUPLICATE_ASSIGNMENT',
        alreadyAssigned: true,
        details: 'Duplicate key error - assignment already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error assigning driver',
      error: error.message
    });
  }
});




router.post('/assign-driver/HourlyBooking', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
   
    console.log('========== ASSIGN DRIVER DEBUG ==========');
    console.log('1. Request body:', req.body);
    console.log('2. req.user:', req.user);
    console.log('3. req.admin:', req.admin);
    
    const { driverID, bookingID, customerID } = req.body;

    // Validate required fields FIRST
    if (!driverID) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID required'
      });
    }
    
    if (!bookingID) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID required'
      });
    }

    if (!customerID) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID required'
      });
    }

    // Get admin ID
    let adminID = null;
    if (req.user) {
      adminID = req.user.adminId || req.user.id || req.user._id || req.user.userId;
    }
    
    if (!adminID && req.admin) {
      adminID = req.admin.adminId || req.admin.id || req.admin._id;
    }

    console.log('4. Extracted adminID:', adminID);

    if (!adminID) {
      return res.status(401).json({
        success: false,
        message: 'Authentication failed - admin not found in request'
      });
    }

    // Check if driver exists
    console.log('5. Looking for driver with ID:', driverID);
    const driver = await Driver.findById(driverID);
    console.log('6. Driver found:', driver ? 'Yes' : 'No');
    
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if booking exists (using HourlyBooking)
    console.log('7. Looking for hourly booking with ID:', bookingID);
    const booking = await HourlyBooking.findById(bookingID);
    console.log('8. Booking found:', booking ? 'Yes' : 'No');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Hourly booking not found'
      });
    }
    
    console.log('9. Booking status:', booking.bookingStatus);

    // Check if customer exists
    console.log('10. Looking for customer with ID:', customerID);
    const customer = await Customer.findById(customerID);
    console.log('11. Customer found:', customer ? 'Yes' : 'No');

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // CHECK FOR EXISTING ASSIGNMENT
    console.log('12. Checking existing assignments for:');
    console.log('   - Driver ID:', driverID);
    console.log('   - Booking ID:', bookingID);
    console.log('   - Customer ID:', customerID);
    
    const existingAssignment = await AdminAssignDriver.findOne({
      driverID: driverID,
      bookingID: bookingID,
      customerID: customerID,
    });

    console.log('13. Existing assignment:', existingAssignment ? 'Found' : 'Not found');

    if (existingAssignment) {
      console.log('14. ⚠️ DUPLICATE ASSIGNMENT ATTEMPT');
      
      // Fetch related data for better error message
      const [assignedAdmin, assignedDriver, assignedBooking] = await Promise.all([
        Admin.findById(existingAssignment.adminID).select('name email'),
        Driver.findById(existingAssignment.driverID).select('driverName phoneNumber email'),
        HourlyBooking.findById(existingAssignment.bookingID).select('hours pickupAdddress dropOffAddress bookingStatus')
      ]);
      
      const adminName = assignedAdmin ? assignedAdmin.name || assignedAdmin.email || 'Unknown Admin' : 'Unknown Admin';
      const driverName = assignedDriver ? assignedDriver.driverName || 'Unknown Driver' : driver?.driverName || 'Unknown Driver';

      return res.status(400).json({
        success: false,
        message: 'This driver is already assigned to this booking',
        error: 'DUPLICATE_ASSIGNMENT',
        alreadyAssigned: true,
        data: {
          assignment: {
            id: existingAssignment._id,
            driver: {
              id: existingAssignment.driverID,
              name: driverName,
              phone: assignedDriver?.phoneNumber || driver?.phoneNumber
            },
            booking: {
              id: existingAssignment.bookingID,
              hours: assignedBooking?.hours || booking.hours,
              pickupAddress: assignedBooking?.pickupAdddress || booking.pickupAdddress,
              status: assignedBooking?.bookingStatus || booking.bookingStatus
            },
            assignedTo: {
              id: existingAssignment.adminID,
              name: adminName,
              email: assignedAdmin?.email
            },
            assignedAt: existingAssignment.assignedAt || existingAssignment.createdAt,
            status: existingAssignment.status
          }
        }
      });
    }

    // Check if booking is already assigned to someone else
    if (booking.driverID && booking.driverID.toString() !== driverID && booking.driverID.toString() !== 'null') {
      const currentDriver = await Driver.findById(booking.driverID).select('driverName phoneNumber');
      
      return res.status(400).json({
        success: false,
        message: 'This booking is already assigned to another driver',
        currentDriver: currentDriver ? {
          id: booking.driverID,
          name: currentDriver.driverName
        } : booking.driverID
      });
    }

    // NO EXISTING ASSIGNMENT - CREATE NEW ONE
    console.log('15. Creating new assignment with adminID:', adminID);
    
    const assignmentData = {
      adminID: adminID.toString(),
      driverID,
      bookingID,
      customerID,
      status: 'active',
      assignedAt: new Date()
    };
    
    const assignment = new AdminAssignDriver(assignmentData);
    await assignment.save();
    console.log('16. Assignment saved with ID:', assignment._id);

    // UPDATE THE BOOKING
    console.log('17. Updating booking with customerID and driverID');
    
    const updatedBooking = await HourlyBooking.findByIdAndUpdate(
      bookingID,
      {
        $set: {
          customerID: customerID,
          driverID: driverID,
          bookingStatus: 'assigned'
        }
      },
      { new: true }
    );

    console.log('18. Booking updated successfully:', updatedBooking ? 'Yes' : 'No');

    // FIXED: Use the correct IDs and models for fetching related data
    console.log('19. Fetching related data with IDs:');
    console.log('   - Assignment ID:', assignment._id);
    console.log('   - Driver ID:', driverID);
    console.log('   - Booking ID:', bookingID);
    console.log('   - Admin ID:', adminID);
    console.log('   - Customer ID:', customerID);

    // Safely fetch related data with error handling
    const [driverData, bookingData, adminData, customerData] = await Promise.all([
      Driver.findById(driverID).select('driverName phoneNumber email vehicleName vehicleNumber').lean(),
      HourlyBooking.findById(bookingID).select('hours pickupAdddress dropOffAddress bookingStatus carName charge').lean(), // FIXED: Changed from Booking to HourlyBooking
      Admin.findById(adminID).select('name email').lean(),
      Customer.findById(customerID).select('name email phone address').lean()
    ]);

    console.log('20. Data fetched:');
    console.log('   - Driver data:', driverData ? 'Yes' : 'No');
    console.log('   - Booking data:', bookingData ? 'Yes' : 'No');
    console.log('   - Admin data:', adminData ? 'Yes' : 'No');
    console.log('   - Customer data:', customerData ? 'Yes' : 'No');

    // SUCCESS RESPONSE
    res.status(201).json({
      success: true,
      message: 'Driver assigned successfully and booking updated',
      data: {
        assignment: {
          id: assignment._id,
          driver: driverData || { 
            id: driverID, 
            name: driver?.driverName || 'Unknown Driver' 
          },
          booking: bookingData || { 
            id: bookingID, 
            hours: booking.hours,
            pickupAddress: booking.pickupAdddress,
            status: booking.bookingStatus 
          },
          customer: customerData || { 
            id: customerID,
            name: customer?.name 
          },
          assignedBy: adminData || { 
            id: adminID 
          },
          assignedAt: assignment.assignedAt,
          status: assignment.status
        },
        bookingUpdate: {
          id: updatedBooking._id,
          customerID: updatedBooking.customerID,
          driverID: updatedBooking.driverID,
          status: updatedBooking.bookingStatus
        }
      }
    });

  } catch (error) {
    console.error('❌ Assign driver error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This driver is already assigned to this booking',
        error: 'DUPLICATE_ASSIGNMENT'
      });
    }
    
    // Handle CastError specifically
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: `Invalid ID format for ${error.path}: ${error.value}`,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error assigning driver',
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
router.put('/assignments/:id',authenticateToken, authorizeAdmin, async (req, res) => {
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
router.delete('/assignments/:id',authenticateToken, authorizeAdmin, async (req, res) => {
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