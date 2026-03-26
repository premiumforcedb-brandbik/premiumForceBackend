const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const HourlyRoute = require('../models/hourlyRoutesModel');
const Cars = require('../models/car_model');
// const Cars = require('../models/car_model');
const Category = require('../models/categoryModel');

const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');







// fromCity to tocity and vehicleid

router.get('/city-to-city/filter', async (req, res) => {
  try {
    const { 
     
      vehicleId, 
      status,
      startDate,
      endDate,
      customerId,
      driverId
    } = req.query;
    
    // Build filter object
    const filter = {
      fromCity: { $exists: true, $ne: null },
      toCity: { $exists: true, $ne: null }
    };
    
    // if (fromCity) filter.fromCity = { $regex: new RegExp(fromCity, 'i') };
    // if (toCity) filter.toCity = { $regex: new RegExp(toCity, 'i') };
    if (vehicleId) filter.vehicleId = vehicleId;
    if (status) filter.bookingStatus = status;
    if (customerId) filter.customerID = customerId;
    if (driverId) filter.driverID = driverId;
    
    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    
    const bookings = await HourlyRoute.find(filter)
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: bookings.length,
      filters: req.query,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});




// ============= CREATE HOURLY ROUTE =============
// POST /api/hourly-routes
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { vehicleID, categoryID, charge, hour, isActive } = req.body;

    console.log('Received data:', req.body);

    // Basic validation
    if (!vehicleID || charge === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID and charge are required'
      });
    }

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(vehicleID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID format'
      });
    }

    if (categoryID && !mongoose.Types.ObjectId.isValid(categoryID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    // Check if vehicle exists
    const existingCar = await Cars.findById(vehicleID);
    if (!existingCar) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Check if category exists (if provided)
    if (categoryID) {
      const category = await Category.findById(categoryID);
      if (!category) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    // Check if hourly route already exists for this vehicle and hour
    const existingRoute = await HourlyRoute.findOne({
      vehicleID: vehicleID,
      hour: hour || 1
    });

    if (existingRoute) {
      return res.status(400).json({
        success: false,
        message: 'Hourly route already exists for this vehicle with the same hour'
      });
    }

    // Create hourly route
    const hourlyRoute = new HourlyRoute({
      vehicleID: vehicleID,
      categoryID: categoryID || null,
      charge: Number(charge),
      hour: hour ? Number(hour) : 1,
      isActive: isActive === 'true' || isActive === true || isActive === undefined
    });

    await hourlyRoute.save();
    
    // Populate references
    await hourlyRoute.populate([
      { path: 'vehicleID', select: 'vehicleNumber model capacity' },
      { path: 'categoryID', select: 'name' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Hourly route created successfully',
      data: hourlyRoute
    });

  } catch (error) {
    console.error('Create hourly route error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Hourly route already exists for this vehicle with the same hour'
      });
    }

    if (error.name === 'ValidationError') {
      const errors = {};
      for (let field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating hourly route',
      error: error.message
    });
  }
});

// ============= GET ALL HOURLY ROUTES =============
// GET /api/hourly-routes
router.get('/', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { 
      vehicleID,
      categoryID,
      isActive,
      minHour,
      maxHour,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    if (vehicleID) {
      if (!mongoose.Types.ObjectId.isValid(vehicleID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid vehicle ID format'
        });
      }
      query.vehicleID = vehicleID;
    }

    if (categoryID) {
      if (!mongoose.Types.ObjectId.isValid(categoryID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid category ID format'
        });
      }
      query.categoryID = categoryID;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (minHour || maxHour) {
      query.hour = {};
      if (minHour) query.hour.$gte = parseInt(minHour);
      if (maxHour) query.hour.$lte = parseInt(maxHour);
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get hourly routes
    const hourlyRoutes = await HourlyRoute.find(query)
      .populate('vehicleID', 'vehicleNumber model capacity')
      .populate('categoryID', 'name')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count
    const total = await HourlyRoute.countDocuments(query);

    res.json({
      success: true,
      message: 'Hourly routes fetched successfully',
      data: hourlyRoutes,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalItems: total,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1
      }
    });

  } catch (error) {
    console.error('Get hourly routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching hourly routes',
      error: error.message
    });
  }
});

// ============= GET HOURLY ROUTE BY ID =============
// GET /api/hourly-routes/:id
router.get('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hourly route ID format'
      });
    }

    const hourlyRoute = await HourlyRoute.findById(id)
      .populate('vehicleID', 'vehicleNumber model capacity')
      .populate('categoryID', 'name');

    if (!hourlyRoute) {
      return res.status(404).json({
        success: false,
        message: 'Hourly route not found'
      });
    }

    res.json({
      success: true,
      data: hourlyRoute
    });

  } catch (error) {
    console.error('Get hourly route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching hourly route',
      error: error.message
    });
  }
});

// ============= UPDATE HOURLY ROUTE =============
// PUT /api/hourly-routes/:id
router.put('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is empty. Please provide data to update.'
      });
    }
    
    const { vehicleID, categoryID, charge, hour, isActive } = req.body;

    console.log('Update request body:', req.body);

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hourly route ID format'
      });
    }

    // Check if route exists
    const existingRoute = await HourlyRoute.findById(id);
    if (!existingRoute) {
      return res.status(404).json({
        success: false,
        message: 'Hourly route not found'
      });
    }

    // Validate category ID if provided
    if (categoryID && !mongoose.Types.ObjectId.isValid(categoryID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category ID format'
      });
    }

    // Validate vehicle ID if provided
    if (vehicleID && !mongoose.Types.ObjectId.isValid(vehicleID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID format'
      });
    }

    // Check if category exists if provided
    if (categoryID) {
      const categoryExists = await Category.findById(categoryID);
      if (!categoryExists) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    // Check if vehicle exists if provided
    if (vehicleID) {
      const vehicleExists = await Cars.findById(vehicleID);
      if (!vehicleExists) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle not found'
        });
      }
    }

    // Check if updated route already exists (excluding current route)
    const newVehicleID = vehicleID || existingRoute.vehicleID;
    const newHour = hour !== undefined ? hour : existingRoute.hour;
    
    if (vehicleID || hour !== undefined) {
      const duplicateRoute = await HourlyRoute.findOne({
        _id: { $ne: id },
        vehicleID: newVehicleID,
        hour: newHour
      });

      if (duplicateRoute) {
        return res.status(400).json({
          success: false,
          message: 'Hourly route already exists for this vehicle with the same hour'
        });
      }
    }

    // Prepare update data
    const updateData = {
      vehicleID: newVehicleID,
      hour: newHour,
      charge: charge !== undefined ? Number(charge) : existingRoute.charge,
      isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : existingRoute.isActive
    };

    // Only update categoryID if provided
    if (categoryID !== undefined) {
      updateData.categoryID = categoryID;
    }

    // Update hourly route
    const updatedRoute = await HourlyRoute.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('vehicleID', 'vehicleNumber model capacity')
      .populate('categoryID', 'name');

    res.json({
      success: true,
      message: 'Hourly route updated successfully',
      data: updatedRoute
    });

  } catch (error) {
    console.error('Update hourly route error:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Hourly route already exists for this vehicle with the same hour'
      });
    }

    if (error.name === 'ValidationError') {
      const errors = {};
      for (let field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating hourly route',
      error: error.message
    });
  }
});


// ============= UPDATE HOURLY ROUTE STATUS ONLY =============
// PATCH /api/hourly-routes/:id/status
router.patch('/:id/status', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive status is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hourly route ID format'
      });
    }

    const hourlyRoute = await HourlyRoute.findById(id);
    if (!hourlyRoute) {
      return res.status(404).json({
        success: false,
        message: 'Hourly route not found'
      });
    }

    const updatedRoute = await HourlyRoute.findByIdAndUpdate(
      id,
      { isActive: isActive === 'true' || isActive === true },
      { new: true }
    ).populate('vehicleID', 'vehicleNumber model capacity')
      .populate('categoryID', 'name');

    res.json({
      success: true,
      message: `Hourly route status updated to ${updatedRoute.isActive ? 'active' : 'inactive'}`,
      data: updatedRoute
    });

  } catch (error) {
    console.error('Update hourly route status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating hourly route status',
      error: error.message
    });
  }
});

// ============= DELETE HOURLY ROUTE =============
// DELETE /api/hourly-routes/:id
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hourly route ID format'
      });
    }

    const hourlyRoute = await HourlyRoute.findById(id);
    if (!hourlyRoute) {
      return res.status(404).json({
        success: false,
        message: 'Hourly route not found'
      });
    }

    await HourlyRoute.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Hourly route deleted successfully'
    });

  } catch (error) {
    console.error('Delete hourly route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting hourly route',
      error: error.message
    });
  }
});

// ============= CALCULATE HOURLY TRIP COST =============
// POST /api/hourly-routes/calculate-cost
router.post('/calculate-cost', authenticateToken, async (req, res) => {
  try {
    const { vehicleID, hours } = req.body;

    if (!vehicleID || !hours) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID and hours are required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(vehicleID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID format'
      });
    }

    const hourlyRoute = await HourlyRoute.findOne({
      vehicleID: vehicleID,
      isActive: true
    });

    if (!hourlyRoute) {
      return res.status(404).json({
        success: false,
        message: 'No active hourly route found for this vehicle'
      });
    }

    const totalCost = hourlyRoute.charge * parseInt(hours);
    const totalCharge = hourlyRoute.totalCharge; // Using virtual field

    res.json({
      success: true,
      data: {
        hourlyRoute: hourlyRoute,
        hours: parseInt(hours),
        chargePerHour: hourlyRoute.charge,
        totalCost: totalCost,
        totalCharge: totalCharge
      }
    });

  } catch (error) {
    console.error('Calculate cost error:', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating cost',
      error: error.message
    });
  }
});

// ============= GET ACTIVE HOURLY ROUTES =============
// GET /api/hourly-routes/active/all
router.get('/active/all', authenticateToken, async (req, res) => {
  try {
    const activeRoutes = await HourlyRoute.findActiveRoutes();

    res.json({
      success: true,
      count: activeRoutes.length,
      data: activeRoutes
    });

  } catch (error) {
    console.error('Get active routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active routes',
      error: error.message
    });
  }
});

// ============= TOGGLE HOURLY ROUTE STATUS =============
// POST /api/hourly-routes/:id/toggle
router.post('/:id/toggle', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hourly route ID format'
      });
    }

    const hourlyRoute = await HourlyRoute.findById(id);
    if (!hourlyRoute) {
      return res.status(404).json({
        success: false,
        message: 'Hourly route not found'
      });
    }

    const updatedRoute = await hourlyRoute.toggleActive();
    await updatedRoute.populate('vehicleID', 'vehicleNumber model capacity');
    await updatedRoute.populate('categoryID', 'name');

    res.json({
      success: true,
      message: `Hourly route status toggled to ${updatedRoute.isActive ? 'active' : 'inactive'}`,
      data: updatedRoute
    });

  } catch (error) {
    console.error('Toggle route status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling route status',
      error: error.message
    });
  }
});

module.exports = router;






