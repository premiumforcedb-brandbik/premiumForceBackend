const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const HourlyRoute = require('../models/hourlyRoutesModel');
const City = require('../models/city_model');
const Cars = require('../models/car_model');

const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

// ============= CREATE HOURLY ROUTE =============
// POST /api/hourly-routes
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { vehicleID, fromCity, toCity, charge, hour, isActive } = req.body;

    console.log('Received data:', req.body);

    // Basic validation
    if (!vehicleID || !fromCity || !toCity || charge === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle ID, from city, to city, and charge are required'
      });
    }

    // Validate all IDs
    if (!mongoose.Types.ObjectId.isValid(vehicleID) || 
        !mongoose.Types.ObjectId.isValid(fromCity) || 
        !mongoose.Types.ObjectId.isValid(toCity)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    // Check if fromCity and toCity are the same
    if (fromCity === toCity) {
      return res.status(400).json({
        success: false,
        message: 'From city and To city cannot be the same'
      });
    }

    // Check if cities exist
    const fromCityExists = await City.findById(fromCity);
    const toCityExists = await City.findById(toCity);

    if (!fromCityExists || !toCityExists) {
      return res.status(404).json({
        success: false,
        message: 'One or both cities not found'
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

    // Check if hourly route already exists for this vehicle and cities
    const existingRoute = await HourlyRoute.findOne({
      vehicleID: vehicleID,
      fromCity: fromCity,
      toCity: toCity,
      hour: hour || 1
    });

    if (existingRoute) {
      return res.status(400).json({
        success: false,
        message: 'Hourly route already exists for this vehicle between these cities'
      });
    }

    // Create hourly route
    const hourlyRoute = new HourlyRoute({
      vehicleID: vehicleID,
      fromCity,
      toCity,
      charge: Number(charge),
      hour: hour ? Number(hour) : 1,
      isActive: isActive === 'true' || isActive === true || isActive === undefined
    });

    await hourlyRoute.save();
    
    // Populate all references
    await hourlyRoute.populate([
      { path: 'vehicleID', select: 'vehicleNumber model capacity' },
      { path: 'fromCity', select: 'name state isActive' },
      { path: 'toCity', select: 'name state isActive' }
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
        message: 'Hourly route already exists for this vehicle between these cities'
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
      fromCity,
      toCity,
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

    if (fromCity) {
      if (!mongoose.Types.ObjectId.isValid(fromCity)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid from city ID format'
        });
      }
      query.fromCity = fromCity;
    }

    if (toCity) {
      if (!mongoose.Types.ObjectId.isValid(toCity)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid to city ID format'
        });
      }
      query.toCity = toCity;
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
      .populate('fromCity toCity', 'name state isActive')
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
      .populate('fromCity toCity', 'name state isActive');

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
    
    // Add this check to see if body exists
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is empty. Please provide data to update.'
      });
    }
    
    const { vehicleID, fromCity, toCity, charge, hour, isActive } = req.body;

    // Log the received data for debugging
    console.log('Update request body:', req.body);
    console.log('Update request params:', req.params);

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

    // Validate city IDs if provided
    if (fromCity && !mongoose.Types.ObjectId.isValid(fromCity)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid from city ID format'
      });
    }

    if (toCity && !mongoose.Types.ObjectId.isValid(toCity)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid to city ID format'
      });
    }

    if (vehicleID && !mongoose.Types.ObjectId.isValid(vehicleID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID format'
      });
    }

    // Check if cities exist if provided
    if (fromCity) {
      const cityExists = await City.findById(fromCity);
      if (!cityExists) {
        return res.status(404).json({
          success: false,
          message: 'From city not found'
        });
      }
    }

    if (toCity) {
      const cityExists = await City.findById(toCity);
      if (!cityExists) {
        return res.status(404).json({
          success: false,
          message: 'To city not found'
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

    // Check if from and to cities are the same
    const newFromCity = fromCity || existingRoute.fromCity;
    const newToCity = toCity || existingRoute.toCity;
    const newVehicleID = vehicleID || existingRoute.vehicleID;
    const newHour = hour !== undefined ? hour : existingRoute.hour;
    
    if (newFromCity.toString() === newToCity.toString()) {
      return res.status(400).json({
        success: false,
        message: 'From city and To city cannot be the same'
      });
    }

    // Check if updated route already exists (excluding current route)
    if (fromCity || toCity || vehicleID || hour !== undefined) {
      const duplicateRoute = await HourlyRoute.findOne({
        _id: { $ne: id },
        fromCity: newFromCity,
        toCity: newToCity,
        vehicleID: newVehicleID,
        hour: newHour
      });

      if (duplicateRoute) {
        return res.status(400).json({
          success: false,
          message: 'Hourly route already exists for this vehicle between these cities'
        });
      }
    }

    // Prepare update data
    const updateData = {
      fromCity: newFromCity,
      toCity: newToCity,
      vehicleID: newVehicleID,
      hour: newHour,
      charge: charge !== undefined ? Number(charge) : existingRoute.charge,
      isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : existingRoute.isActive
    };

    // Update hourly route
    const updatedRoute = await HourlyRoute.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('vehicleID', 'vehicleNumber model capacity')
      .populate('fromCity toCity', 'name state isActive');

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
        message: 'Hourly route already exists for this vehicle between these cities'
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
      .populate('fromCity toCity', 'name state isActive');

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

// ============= GET ROUTES BY VEHICLE =============
// GET /api/hourly-routes/vehicle/:vehicleId
router.get('/vehicle/:vehicleId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { isActive, page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID format'
      });
    }

    // Check if vehicle exists
    const vehicleExists = await Cars.findById(vehicleId);
    if (!vehicleExists) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Build query
    const query = { vehicleID: vehicleId };

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Get hourly routes
    const hourlyRoutes = await HourlyRoute.find(query)
      .populate('vehicleID', 'vehicleNumber model capacity')
      .populate('fromCity toCity', 'name state isActive')
      .sort({ hour: 1 })
      .skip(skip)
      .limit(limitNum);

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
    console.error('Get routes by vehicle error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching routes',
      error: error.message
    });
  }
});

// ============= GET ROUTES BY CITY =============
// GET /api/hourly-routes/city/:cityId
router.get('/city/:cityId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { cityId } = req.params;
    const { isActive, page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(cityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    // Check if city exists
    const cityExists = await City.findById(cityId);
    if (!cityExists) {
      return res.status(404).json({
        success: false,
        message: 'City not found'
      });
    }

    // Build query
    const query = {
      $or: [
        { fromCity: cityId },
        { toCity: cityId }
      ]
    };

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Get hourly routes
    const hourlyRoutes = await HourlyRoute.find(query)
      .populate('vehicleID', 'vehicleNumber model capacity')
      .populate('fromCity toCity', 'name state isActive')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

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
    console.error('Get routes by city error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching routes',
      error: error.message
    });
  }
});

// ============= GET HOURLY ROUTE BETWEEN TWO CITIES =============
// GET /api/hourly-routes/between/:fromCityId/:toCityId
router.get('/between/:fromCityId/:toCityId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { fromCityId, toCityId } = req.params;
    const { vehicleID } = req.query;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(fromCityId) || !mongoose.Types.ObjectId.isValid(toCityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    // Build query
    const query = {
      fromCity: fromCityId,
      toCity: toCityId,
      isActive: true
    };

    if (vehicleID) {
      if (!mongoose.Types.ObjectId.isValid(vehicleID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid vehicle ID format'
        });
      }
      query.vehicleID = vehicleID;
    }

    const hourlyRoutes = await HourlyRoute.find(query)
      .populate('vehicleID', 'vehicleNumber model capacity')
      .populate('fromCity toCity', 'name state isActive')
      .sort({ hour: 1 });

    if (hourlyRoutes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No hourly routes found between these cities'
      });
    }

    res.json({
      success: true,
      count: hourlyRoutes.length,
      data: hourlyRoutes
    });

  } catch (error) {
    console.error('Get routes between cities error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching routes',
      error: error.message
    });
  }
});

// ============= CALCULATE TRIP COST =============
// POST /api/hourly-routes/calculate-cost
router.post('/calculate-cost', authenticateToken, async (req, res) => {
  try {
    const { fromCityId, toCityId, vehicleID, hours } = req.body;

    if (!fromCityId || !toCityId || !vehicleID || !hours) {
      return res.status(400).json({
        success: false,
        message: 'From city, to city, vehicle ID, and hours are required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(fromCityId) || 
        !mongoose.Types.ObjectId.isValid(toCityId) || 
        !mongoose.Types.ObjectId.isValid(vehicleID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const hourlyRoute = await HourlyRoute.findOne({
      fromCity: fromCityId,
      toCity: toCityId,
      vehicleID: vehicleID,
      isActive: true
    });

    if (!hourlyRoute) {
      return res.status(404).json({
        success: false,
        message: 'No active hourly route found for this vehicle between these cities'
      });
    }

    const totalCost = hourlyRoute.charge * parseInt(hours);

    res.json({
      success: true,
      data: {
        hourlyRoute: hourlyRoute,
        hours: parseInt(hours),
        chargePerHour: hourlyRoute.charge,
        totalCost: totalCost
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

module.exports = router;