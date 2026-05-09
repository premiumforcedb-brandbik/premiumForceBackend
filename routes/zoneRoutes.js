// routes/zoneRoutes.js
const express = require('express');
const router = express.Router();
const Zone = require('../models/zoneModel');
const mongoose = require('mongoose');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

// ==================== CREATE ZONE ====================
router.post('/zones',
  authenticateToken,
  authorizeAdmin,
  async (req, res) => {
    try {
      const { name, nameAr, cityID, coordinates } = req.body;

      // Validation
      if (!name || !nameAr || !cityID || !coordinates || coordinates.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: name, nameAr, cityID, and at least 3 coordinates'
        });
      }

      // Check if zone with same name exists
      const existingZone = await Zone.findOne({ name });
      if (existingZone) {
        return res.status(400).json({
          success: false,
          message: 'Zone with this name already exists'
        });
      }

      // Create zone
      const zone = new Zone({
        name,
        nameAr,
        cityID,
        coordinates,
        createdBy: req.user?.id || new mongoose.Types.ObjectId() // Replace with actual user ID from auth
      });

      await zone.save();

      res.status(201).json({
        success: true,
        message: 'Zone created successfully',
        data: zone
      });
    } catch (error) {
      console.error('Create zone error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== GET ALL ZONES ====================
router.get('/zones',
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { cityID, isActive, page = 1, limit = 10 } = req.query;

      const filter = {};
      if (cityID) filter.cityID = cityID;
      if (isActive !== undefined) filter.isActive = isActive === 'true';

      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [zones, total] = await Promise.all([
        Zone.find(filter)
          .populate('cityID', 'cityName cityNameAr')
          .populate('createdBy', 'username email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Zone.countDocuments(filter)
      ]);

      res.json({
        success: true,
        data: zones,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Get zones error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== GET ZONE BY ID ====================
router.get('/zones/:id',
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const zone = await Zone.findById(req.params.id)
        .populate('cityID', 'cityName cityNameAr')
        .populate('createdBy', 'username email');

      if (!zone) {
        return res.status(404).json({
          success: false,
          message: 'Zone not found'
        });
      }

      res.json({
        success: true,
        data: zone
      });
    } catch (error) {
      console.error('Get zone error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== UPDATE ZONE ====================
router.put('/zones/:id',
  authenticateToken, authorizeAdmin,
  async (req, res) => {
    try {
      const { name, nameAr, cityID, coordinates, isActive } = req.body;

      const zone = await Zone.findById(req.params.id);
      if (!zone) {
        return res.status(404).json({
          success: false,
          message: 'Zone not found'
        });
      }


      const cityExists = await mongoose.model('City').exists({ _id: cityID });
      if (!cityExists) {
        return res.status(400).json({
          success: false, message: 'Invalid cityID, city does not exist'
        });
      }

      // Check if name is being changed and if it already exists
      if (name && name !== zone.name) {
        const existingZone = await Zone.findOne({ name });
        if (existingZone) {
          return res.status(400).json({
            success: false,
            message: 'Zone with this name already exists'
          });
        }
      }

      // Update fields
      if (name) zone.name = name;
      if (nameAr) zone.nameAr = nameAr;
      if (cityID) zone.cityID = cityID;
      if (coordinates) {
        if (coordinates.length < 3) {
          return res.status(400).json({
            success: false,
            message: 'At least 3 coordinates are required'
          });
        }
        zone.coordinates = coordinates;
      }
      if (isActive !== undefined) zone.isActive = isActive;

      await zone.save();

      res.json({
        success: true,
        message: 'Zone updated successfully',
        data: zone
      });
    } catch (error) {
      console.error('Update zone error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== DELETE ZONE ====================
router.delete('/zones/:id',
  authenticateToken, authorizeAdmin,
  async (req, res) => {
    try {
      const zone = await Zone.findById(req.params.id);
      if (!zone) {
        return res.status(404).json({
          success: false,
          message: 'Zone not found'
        });
      }

      await zone.deleteOne();

      res.json({
        success: true,
        message: 'Zone deleted successfully'
      });
    } catch (error) {
      console.error('Delete zone error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== CHECK IF POINT IS IN ZONE ====================
router.post('/zones/check-point',
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { lat, lng, zoneId } = req.body;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: 'Latitude and longitude are required'
        });
      }

      let zones = [];

      if (zoneId) {
        // Check specific zone
        const zone = await Zone.findById(zoneId);
        if (!zone) {
          return res.status(404).json({
            success: false,
            message: 'Zone not found'
          });
        }
        zones = [zone];
      } else {
        // Check all active zones
        zones = await Zone.find({ isActive: true });
      }

      const results = zones.map(zone => ({
        zoneId: zone._id,
        name: zone.name,
        nameAr: zone.nameAr,
        isInside: zone.containsPoint(lat, lng)
      }));

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      console.error('Check point error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== GET ZONES BY CITY ====================
router.get('/zones/city/:cityId',
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { cityId } = req.params;
      const { isActive = true } = req.query;

      const zones = await Zone.find({
        cityID: cityId,
        isActive: isActive === 'true'
      }).populate('cityID', 'cityName cityNameAr');

      res.json({
        success: true,
        data: zones,
        count: zones.length
      });
    } catch (error) {
      console.error('Get zones by city error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);




module.exports = router;