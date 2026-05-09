const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Route = require('../models/routeModel');
const City = require('../models/city_model');
const HourlyRoute = require('../models/hourlyRoutesModel');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

const Cars = require('../models/car_model');




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




// get price and details 

// ============= GET ALL ROUTES =============
// GET /api/routes
router.get('/FromcityToCity/vehicleRoutePrice', async (req, res) => {
  try {
    const {
      fromCity,
      toCity,
      isActive,
      vehicleID,  // Add vehicleID filter if needed
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

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

    if (vehicleID) {
      if (!mongoose.Types.ObjectId.isValid(vehicleID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid vehicle ID format'
        });
      }
      query.vehicleID = vehicleID;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get routes with FULL population
    const routes = await Route.find(query)
      .populate('vehicleID', 'carName brand model vehicleNumber') // Get full vehicle details
      .populate('fromCity', 'cityName state pincode isActive') // Get full from city details
      .populate('toCity', 'cityName state pincode isActive') // Get full to city details
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count
    const total = await Route.countDocuments(query);

    res.json({
      success: true,
      message: 'Routes fetched successfully',
      data: routes,
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
    console.error('Get routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching routes',
      error: error.message
    });
  }
});

// ============= CREATE ROUTE =============
// POST /api/routes
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { hour, charge, isActive, vehicleID } = req.body;

    console.log('Received data:', req.body);
    console.log('VehicleID:', vehicleID);


    // Basic validation - include VehicleID
    if (charge === undefined || !vehicleID) {
      return res.status(400).json({
        success: false,
        message: 'vehicle ID and charge are all required'
      });
    }

    // Validate all IDs
    if (
      !mongoose.Types.ObjectId.isValid(vehicleID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }




    // Check if vehicle exists
    const existingCar = await Cars.findById(vehicleID); // Use VehicleID from destructuring

    console.log('Existing car:', existingCar);

    if (!existingCar) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Check if route already exists for this vehicle and cities
    const existingRoute = await HourlyRoute.findOne({
      vehicleID: vehicleID,
      hour: hour // Include VehicleID in the check
    });

    if (existingRoute) {
      return res.status(400).json({
        success: false,
        message: 'Route already exists for this vehicle'
      });
    }

    // Create route - FIX: Include VehicleID!
    const route = new HourlyRoute({
      hour: hour,
      vehicleID: vehicleID,  // ← This was missing!
      charge: Number(charge),
      isActive: isActive === 'true' || isActive === true || isActive === undefined
    });

    await route.save();

    // Populate all references
    await route.populate([
      { path: 'vehicleID', select: 'charge hour isActive' }
    ]);

    res.status(201).json({
      success: true,
      message: 'Route created successfully',
      data: route
    });

  } catch (error) {
    console.error('Create route error:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Route already exists for this vehicle between these cities'
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
      message: 'Error creating route',
      error: error.message
    });
  }
});


// ============= UPDATE ROUTE (PUT) =============
// PUT /api/routes/:id
router.put('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { hour, charge, isActive, vehicleID, onExist = 'update' } = req.body;

    console.log('Updating route ID:', id);
    console.log('Strategy on exist:', onExist);
    console.log('Received update data:', req.body);

    // Validate route ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid route ID format'
      });
    }

    // Check if route exists
    const existingRoute = await HourlyRoute.findById(id);
    if (!existingRoute) {
      return res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    }

    // Validate vehicleID if provided
    if (vehicleID && !mongoose.Types.ObjectId.isValid(vehicleID)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID format'
      });
    }

    // Check if vehicle exists when vehicleID is provided
    if (vehicleID) {
      const existingCar = await Cars.findById(vehicleID);
      if (!existingCar) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle not found'
        });
      }
    }

    // Determine final values after update
    const finalVehicleID = vehicleID !== undefined ? vehicleID : existingRoute.vehicleID;
    const finalHour = hour !== undefined ? hour : existingRoute.hour;

    // Check if values are actually changing
    const isVehicleChanging = vehicleID !== undefined && vehicleID.toString() !== existingRoute.vehicleID.toString();
    const isHourChanging = hour !== undefined && hour !== existingRoute.hour;
    const isChargeChanging = charge !== undefined && charge !== existingRoute.charge;
    const isActiveChanging = isActive !== undefined && isActive !== existingRoute.isActive;

    console.log('Changes detected:', {
      isVehicleChanging,
      isHourChanging,
      isChargeChanging,
      isActiveChanging
    });

    // STRATEGY 1: CREATE NEW ROUTE (don't update anything, create a brand new route)
    if (onExist === 'create_new') {
      console.log('🆕 Creating new route (create_new strategy)...');

      // Check if the combination already exists in ANY route
      const existingCombination = await HourlyRoute.findOne({
        vehicleID: finalVehicleID,
        hour: finalHour
      });

      if (existingCombination) {
        return res.status(400).json({
          success: false,
          message: `Cannot create new route: Vehicle ${finalVehicleID} already has a route for hour ${finalHour}`,
          action: 'failed',
          existingRoute: {
            id: existingCombination._id,
            vehicleID: existingCombination.vehicleID,
            hour: existingCombination.hour,
            charge: existingCombination.charge
          },
          suggestion: 'Use a different hour (1, 8, 12, 99) or a different vehicle'
        });
      }

      // Create brand new route with the requested values
      const newRouteData = {
        vehicleID: finalVehicleID,
        hour: finalHour,
        charge: charge !== undefined ? Number(charge) : existingRoute.charge,
        isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : existingRoute.isActive
      };

      const newRoute = new HourlyRoute(newRouteData);
      await newRoute.save();
      await newRoute.populate({ path: 'vehicleID' });

      return res.status(201).json({
        success: true,
        message: 'New route created successfully',
        action: 'created_new',
        originalRoute: {
          id: existingRoute._id,
          vehicleID: existingRoute.vehicleID,
          hour: existingRoute.hour,
          charge: existingRoute.charge,
          isActive: existingRoute.isActive
        },
        newRoute: newRoute
      });
    }

    // STRATEGY 2: UPDATE (default - update the current route)
    // If only updating charge or isActive, just update the current route
    if (!isVehicleChanging && !isHourChanging) {
      console.log('📝 Only updating charge/isActive, updating current route');

      const updateData = {};
      if (charge !== undefined) updateData.charge = Number(charge);
      if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;

      const updatedRoute = await HourlyRoute.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      ).populate({ path: 'vehicleID' });

      return res.status(200).json({
        success: true,
        message: 'Route updated successfully',
        action: 'updated',
        data: updatedRoute
      });
    }

    // If changing vehicle or hour, check for duplicates
    if (isVehicleChanging || isHourChanging) {
      // Check if there's ANOTHER route with the same vehicleID and hour
      const duplicateRoute = await HourlyRoute.findOne({
        _id: { $ne: id }, // Exclude current route
        vehicleID: finalVehicleID,
        hour: finalHour
      });

      console.log('Duplicate check:', {
        finalVehicleID,
        finalHour,
        duplicateFound: !!duplicateRoute,
        duplicateId: duplicateRoute?._id
      });

      if (duplicateRoute) {
        // Handle duplicate based on strategy
        if (onExist === 'replace') {
          console.log('🔄 Replacing: Deleting duplicate and updating current...');
          await HourlyRoute.findByIdAndDelete(duplicateRoute._id);
        } else {
          // Default: return conflict error
          return res.status(409).json({
            success: false,
            message: `Route already exists for vehicle ${finalVehicleID} at hour ${finalHour}`,
            action: 'conflict',
            conflict: {
              existingRouteId: duplicateRoute._id,
              vehicleID: finalVehicleID,
              hour: finalHour,
              charge: duplicateRoute.charge
            },
            currentRoute: {
              id: existingRoute._id,
              vehicleID: existingRoute.vehicleID,
              hour: existingRoute.hour
            },
            suggestions: {
              create_new: 'Set "onExist": "create_new" to create a brand new route',
              replace: 'Set "onExist": "replace" to delete the duplicate and update this route',
              update_only_charge: 'Only update charge or isActive without changing vehicleID/hour'
            }
          });
        }
      }
    }

    // Proceed with normal update (no duplicate found)
    const updateData = {};
    if (hour !== undefined) updateData.hour = hour;
    if (vehicleID !== undefined) updateData.vehicleID = vehicleID;
    if (charge !== undefined) updateData.charge = Number(charge);
    if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;

    const updatedRoute = await HourlyRoute.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate({ path: 'vehicleID' });

    res.status(200).json({
      success: true,
      message: 'Route updated successfully',
      action: 'updated',
      data: updatedRoute
    });

  } catch (error) {
    console.error('Update route error:', error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate route: This vehicle already has a route for the specified hour',
        errorCode: 'DUPLICATE_KEY',
        suggestion: 'Try using onExist: "create_new" to create a new route, or only update charge/isActive without changing vehicleID/hour'
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
      message: 'Error updating route',
      error: error.message
    });
  }
});











// // Also update the PUT method with the same validation
// router.put('/:id',
//   //  authenticateToken, authorizeAdmin,
//   async (req, res) => {
//     try {
//       const { id } = req.params;
//       const { hour, charge, isActive, vehicleID } = req.body;

//       // Validate ID
//       if (!mongoose.Types.ObjectId.isValid(id)) {
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid route ID format'
//         });
//       }

//       // Check if route exists
//       const existingRoute = await HourlyRoute.findById(id);
//       if (!existingRoute) {
//         return res.status(404).json({
//           success: false,
//           message: 'Route not found'
//         });
//       }




//       if (vehicleID && !mongoose.Types.ObjectId.isValid(vehicleID)) {
//         return res.status(400).json({
//           success: false,
//           message: 'Invalid vehicle ID format'
//         });
//       }




//       const newVehicleID = vehicleID || existingRoute.vehicleID;




//       // Check if updated route already exists (excluding current route)
//       if (vehicleID) {
//         const duplicateRoute = await HourlyRoute.findOne({
//           _id: { $ne: id },
//           vehicleID: newVehicleID,
//           hour: hour
//         });

//         if (duplicateRoute) {
//           return res.status(400).json({
//             success: false,
//             message: 'Route already exists'
//           });
//         }
//       }


//       // Prepare update data
//       const updateData = {
//         hour: hour !== undefined ? Number(hour) : existingRoute.hour,
//         charge: charge !== undefined ? Number(charge) : existingRoute.charge,
//         isActive: isActive !== undefined ? isActive === 'true' || isActive === true : existingRoute.isActive
//       };

//       // Update route
//       const updatedRoute = await HourlyRoute.findByIdAndUpdate(
//         id,
//         updateData,
//         { new: true, runValidators: true }
//       ).populate('vehicleID', 'charge hour isActive');

//       res.json({
//         success: true,
//         message: 'Route updated successfully',
//         data: updatedRoute
//       });

//     } catch (error) {
//       console.error('Update route error:', error);

//       if (error.code === 11000) {
//         return res.status(400).json({
//           success: false,
//           message: 'Route already exists between these cities'
//         });
//       }

//       if (error.name === 'ValidationError') {
//         const errors = {};
//         for (let field in error.errors) {
//           errors[field] = error.errors[field].message;
//         }
//         return res.status(400).json({
//           success: false,
//           message: 'Validation error',
//           errors: errors
//         });
//       }

//       res.status(500).json({
//         success: false,
//         message: 'Error updating route',
//         error: error.message
//       });
//     }
//   });






// ============= CREATE ROUTE =============
// // POST /api/routes
// router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const { fromCity, toCity, charge, isActive } = req.body;

//     // Basic validation
//     if (!fromCity || !toCity || charge === undefined) {
//       return res.status(400).json({
//         success: false,
//         message: 'From city, to city, and charge are required'
//       });
//     }

//     // Validate IDs
//     if (!mongoose.Types.ObjectId.isValid(fromCity) || !mongoose.Types.ObjectId.isValid(toCity)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid city ID format'
//       });
//     }

//     // Check if cities exist
//     const fromCityExists = await City.findById(fromCity);
//     const toCityExists = await City.findById(toCity);

//     if (!fromCityExists || !toCityExists) {
//       return res.status(404).json({
//         success: false,
//         message: 'One or both cities not found'
//       });
//     }

//     // Check if route already exists
//     const existingRoute = await Route.findOne({
//       fromCity: fromCity,
//       toCity: toCity
//     });

//     if (existingRoute) {
//       return res.status(400).json({
//         success: false,
//         message: 'Route already exists between these cities'
//       });
//     }

//     // Create route
//     const route = new Route({
//       fromCity,
//       toCity,
//       charge: Number(charge),
//       isActive: isActive === 'true' || isActive === true || isActive === undefined
//     });

//     await route.save();
//     await route.populate('fromCity toCity', 'cityName isActive');

//     res.status(201).json({
//       success: true,
//       message: 'Route created successfully',
//       data: route
//     });

//   } catch (error) {
//     console.error('Create route error:', error);

//     if (error.code === 11000) {
//       return res.status(400).json({
//         success: false,
//         message: 'Route already exists between these cities'
//       });
//     }

//     if (error.name === 'ValidationError') {
//       const errors = {};
//       for (let field in error.errors) {
//         errors[field] = error.errors[field].message;
//       }
//       return res.status(400).json({
//         success: false,
//         message: 'Validation error',
//         errors: errors
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Error creating route',
//       error: error.message
//     });
//   }
// });

// ============= GET ALL ROUTES =============
// GET /api/routes
router.get('/', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const {
      fromCity,
      toCity,
      isActive,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

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

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Sort
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get routes
    const routes = await Route.find(query)
      .populate('fromCity toCity', 'cityName isActive')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    // Get total count
    const total = await Route.countDocuments(query);

    res.json({
      success: true,
      message: 'Routes fetched successfully',
      data: routes,
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
    console.error('Get routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching routes',
      error: error.message
    });
  }
});

// ============= GET ROUTE BY ID =============
// GET /api/routes/:id
router.get('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid route ID format'
      });
    }

    const route = await Route.findById(id)
      .populate('fromCity toCity', 'cityName isActive');

    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    }

    res.json({
      success: true,
      data: route
    });

  } catch (error) {
    console.error('Get route error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching route',
      error: error.message
    });
  }
});



// ============= UPDATE ROUTE =============
// PUT /api/routes/:id
// router.put('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { fromCity, toCity, charge, isActive } = req.body;

//     // Validate ID
//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid route ID format'
//       });
//     }

//     // Check if route exists
//     const existingRoute = await Route.findById(id);
//     if (!existingRoute) {
//       return res.status(404).json({
//         success: false,
//         message: 'Route not found'
//       });
//     }

//     // Validate city IDs if provided
//     if (fromCity && !mongoose.Types.ObjectId.isValid(fromCity)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid from city ID format'
//       });
//     }

//     if (toCity && !mongoose.Types.ObjectId.isValid(toCity)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid to city ID format'
//       });
//     }

//     // Check if cities exist if provided
//     if (fromCity) {
//       const cityExists = await City.findById(fromCity);
//       if (!cityExists) {
//         return res.status(404).json({
//           success: false,
//           message: 'From city not found'
//         });
//       }
//     }

//     if (toCity) {
//       const cityExists = await City.findById(toCity);
//       if (!cityExists) {
//         return res.status(404).json({
//           success: false,
//           message: 'To city not found'
//         });
//       }
//     }

//     // Check if from and to cities are same
//     const newFromCity = fromCity || existingRoute.fromCity;
//     const newToCity = toCity || existingRoute.toCity;

//     if (newFromCity.toString() === newToCity.toString()) {
//       return res.status(400).json({
//         success: false,
//         message: 'From city and To city cannot be the same'
//       });
//     }

//     // Check if updated route already exists (excluding current route)
//     if (fromCity || toCity) {
//       const duplicateRoute = await Route.findOne({
//         _id: { $ne: id },
//         fromCity: newFromCity,
//         toCity: newToCity
//       });

//       if (duplicateRoute) {
//         return res.status(400).json({
//           success: false,
//           message: 'Route already exists between these cities'
//         });
//       }
//     }

//     // Prepare update data
//     const updateData = {
//       fromCity: newFromCity,
//       toCity: newToCity,
//       charge: charge !== undefined ? Number(charge) : existingRoute.charge,
//       isActive: isActive !== undefined ? isActive === 'true' || isActive === true : existingRoute.isActive
//     };

//     // Update route
//     const updatedRoute = await Route.findByIdAndUpdate(
//       id,
//       updateData,
//       { new: true, runValidators: true }
//     ).populate('fromCity toCity', 'cityName isActive');

//     res.json({
//       success: true,
//       message: 'Route updated successfully',
//       data: updatedRoute
//     });

//   } catch (error) {
//     console.error('Update route error:', error);

//     if (error.code === 11000) {
//       return res.status(400).json({
//         success: false,
//         message: 'Route already exists between these cities'
//       });
//     }

//     if (error.name === 'ValidationError') {
//       const errors = {};
//       for (let field in error.errors) {
//         errors[field] = error.errors[field].message;
//       }
//       return res.status(400).json({
//         success: false,
//         message: 'Validation error',
//         errors: errors
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: 'Error updating route',
//       error: error.message
//     });
//   }
// });

// ============= UPDATE ROUTE STATUS ONLY =============
// PATCH /api/routes/:id/status
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
        message: 'Invalid route ID format'
      });
    }

    const route = await Route.findById(id);
    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    }

    const updatedRoute = await Route.findByIdAndUpdate(
      id,
      { isActive: isActive === 'true' || isActive === true },
      { new: true }
    ).populate('fromCity toCity', 'cityName isActive');

    res.json({
      success: true,
      message: `Route status updated to ${updatedRoute.isActive ? 'active' : 'inactive'}`,
      data: updatedRoute
    });

  } catch (error) {
    console.error('Update route status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating route status',
      error: error.message
    });
  }
});



// ============= GET ROUTES BY CITY =============
// GET /api/routes/city/:cityId - Get all routes for a specific city (as from or to)
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

    // Get routes
    const routes = await Route.find(query)
      .populate('fromCity toCity', 'cityName isActive')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Route.countDocuments(query);

    res.json({
      success: true,
      message: 'Routes fetched successfully',
      data: routes,
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

// ============= GET ROUTE BETWEEN TWO CITIES =============
// GET /api/routes/between/:fromCityId/:toCityId
router.get('/between/:fromCityId/:toCityId',
  // authenticateToken, authorizeAdmin, 
  async (req, res) => {
    try {
      const { fromCityId, toCityId } = req.params;

      // Validate IDs
      if (!mongoose.Types.ObjectId.isValid(fromCityId) || !mongoose.Types.ObjectId.isValid(toCityId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid city ID format'
        });
      }

      const route = await Route.findOne({
        fromCity: fromCityId,
        toCity: toCityId
      }).populate('fromCity toCity', 'cityName vehicleID isActive');

      if (!route) {
        return res.status(404).json({
          success: false,
          message: 'Route not found between these cities'
        });
      }

      res.json({
        success: true,
        data: route
      });

    } catch (error) {
      console.error('Get route between cities error:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching route',
        error: error.message
      });
    }
  });




// ============= GET VEHICLE DETAILS WITH HOUR AND PRICE =============
// GET /api/hourly-routes/vehicle/:vehicleId
// @desc    Get vehicle details with hourly pricing
router.get('/vehicle/:vehicleId', async (req, res) => {
  try {
    const { vehicleId } = req.params;

    // Validate vehicle ID
    if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID format'
      });
    }

    // Get vehicle details
    const vehicle = await Cars.findById(vehicleId)
      .populate('categoryID', 'name description');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found'
      });
    }

    // Get all active hourly routes for this vehicle
    const hourlyRoutes = await HourlyRoute.find({
      vehicleID: vehicleId,
      isActive: true
    }).sort({ hour: 1 });

    if (!hourlyRoutes || hourlyRoutes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No hourly pricing found for this vehicle'
      });
    }

    // Prepare response
    res.json({
      success: true,
      data: {
        vehicle: {
          id: vehicle._id,
          vehicleNumber: vehicle.vehicleNumber,
          model: vehicle.model,
          capacity: vehicle.capacity,
          category: vehicle.categoryID
        },
        pricing: hourlyRoutes.map(route => ({
          id: route._id,
          hour: route.hour,
          price: route.charge,
          isActive: route.isActive
        }))
      }
    });

  } catch (error) {
    console.error('Get vehicle details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vehicle details',
      error: error.message
    });
  }
});





// ============= SIMPLER VERSION - JUST CARS WITH BASIC DETAILS =============
// GET /api/routes/between/:fromCityId/:toCityId/cars
router.get('/between/:fromCityId/:toCityId/cars', async (req, res) => {
  try {
    const { fromCityId, toCityId } = req.params;

    // Validate IDs
    if (!mongoose.Types.ObjectId.isValid(fromCityId) || !mongoose.Types.ObjectId.isValid(toCityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid city ID format'
      });
    }

    // Find routes with populated vehicle and city details
    const routes = await Route.find({
      fromCity: fromCityId,
      toCity: toCityId,
      isActive: true
    }).populate([
      {
        path: 'vehicleID',
        select: 'carName brand model vehicleNumber capacity acAvailable wifiAvailable images amenities driverName driverPhone contactNumber pricePerKm'
      },
      {
        path: 'fromCity',
        select: 'cityName state'
      },
      {
        path: 'toCity',
        select: 'cityName state'
      }
    ]);

    if (!routes || routes.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No routes found between these cities'
      });
    }

    // Extract car information
    const cars = routes.map(route => ({
      routeId: route._id,
      price: route.charge,
      carDetails: route.vehicleID,
      fromCity: route.fromCity,
      toCity: route.toCity
    }));

    res.json({
      success: true,
      message: 'Cars fetched successfully',
      data: {
        totalCars: cars.length,
        cars: cars
      }
    });

  } catch (error) {
    console.error('Get cars error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching cars',
      error: error.message
    });
  }
});





/**
 * @route   DELETE /api/hourly-routes/:id
 * @desc    Delete hourly route
 * @access  Private (Admin only)
 */
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid route ID format'
      });
    }

    const hourlyRoute = await HourlyRoute.findByIdAndDelete(id);

    if (!hourlyRoute) {
      return res.status(404).json({
        success: false,
        message: 'Hourly route not found'
      });
    }

    res.status(200).json({
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

module.exports = router;