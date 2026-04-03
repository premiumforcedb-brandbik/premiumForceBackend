const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const HourlyRoute = require('../models/hourlyRoutesModel');
const Cars = require('../models/car_model');

const Category = require('../models/categoryModel');

const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');






// ============= GET ALL CARS BY HOURS (CLEAN VERSION) =============
// GET /api/hourly-routes/cars/:hours
router.get('/cars/:hours', async (req, res) => {
  try {
    const { hours } = req.params;
    const requestedHours = parseInt(hours);

    if (isNaN(requestedHours) || requestedHours <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid hours (positive number)'
      });
    }

    const routes = await HourlyRoute.find({ 
      hour: requestedHours, 
    }).populate('vehicleID');

    if (!routes || routes.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No cars found for ${requestedHours} hour(s)`
      });
    }

    const cars = routes.map(route => {
      const vehicle = route.vehicleID;
      return {
        route: {
          id: route._id,
          hour: route.hour,
          hourlyPrice: route.charge,
      
        },
        car: {
          id: vehicle?._id,
          name: vehicle?.carName,
          brand: vehicle?.brand,
          model: vehicle?.model,
          passengers: vehicle?.numberOfPassengers,
          minDistance: vehicle?.minimumChargeDistance,
          image: vehicle?.carImage,
          categoryId: vehicle?.categoryID,
          brandId: vehicle?.brandID
        }
      };
    });

    res.json({
      success: true,
      summary: {
        hours: requestedHours,
        totalCars: cars.length
      },
      cars: cars
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cars',
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






