// routes/zonePricingRoutes.js
const express = require('express');
const router = express.Router();
const ZonePricing = require('../models/zonePriceModel');
const Zone = require('../models/zoneModel');
const mongoose = require('mongoose');



// ==================== CREATE ZONE PRICING ====================
router.post('/zone-pricing', 
  // authenticateToken, authorizeAdmin, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { zoneFromId, zoneToId, vehicleId, charge } = req.body;

   
         const vehicleExists = await mongoose.model('Car').exists({ _id: vehicleId });

         if (!vehicleExists) {
           return res.status(400).json({   
           success: false,  
            message: 'Invalid vehicleId, vehicle does not exist'
         });

         }

      // Validation
      if (!zoneFromId || !zoneToId || !vehicleId || charge === undefined) {
        return res.status(400).json({
          success: false,
          message: 'Please provide all required fields: zoneFromId, zoneToId, vehicleId, charge'
        });
      }

      // Check if zone pricing already exists
      const existingPricing = await ZonePricing.findOne({
        zoneFromId,
        zoneToId,
        vehicleId
      });

      if (existingPricing) {
        return res.status(400).json({
          success: false,
          message: 'Pricing already exists for this zone pair and vehicle'
        });
      }

      // Validate zones exist
      const [zoneFrom, zoneTo] = await Promise.all([
        Zone.findById(zoneFromId),
        Zone.findById(zoneToId)
      ]);

      if (!zoneFrom || !zoneTo) {
        return res.status(404).json({
          success: false,
          message: 'One or both zones not found'
        });
      }

      // Create zone pricing
      const zonePricing = new ZonePricing({
        zoneFromId,
        zoneToId,
        vehicleId,
        charge,
        createdBy: req.user?.id || new mongoose.Types.ObjectId() // Replace with actual user ID
      });

      await zonePricing.save();

      // Populate references for response
      await zonePricing.populate([
        { path: 'zoneFromId', select: 'name nameAr' },
        { path: 'zoneToId', select: 'name nameAr' },
        { path: 'vehicleId', select: 'name type' }
      ]);

      res.status(201).json({
        success: true,
        message: 'Zone pricing created successfully',
        data: zonePricing
      });
    } catch (error) {
      console.error('Create zone pricing error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== GET ALL ZONE PRICINGS ====================
router.get('/zone-pricing', 
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { zoneFromId, zoneToId, vehicleId, isActive, page = 1, limit = 10 } = req.query;
      
      const filter = {};
      if (zoneFromId) filter.zoneFromId = zoneFromId;
      if (zoneToId) filter.zoneToId = zoneToId;
      if (vehicleId) filter.vehicleId = vehicleId;
      if (isActive !== undefined) filter.isActive = isActive === 'true';
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [pricings, total] = await Promise.all([
        ZonePricing.find(filter)
          .populate('zoneFromId', 'name nameAr')
          .populate('zoneToId', 'name nameAr')
          .populate('vehicleId', 'name type')
          .populate('createdBy', 'username email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        ZonePricing.countDocuments(filter)
      ]);
      
      res.json({
        success: true,
        data: pricings,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Get zone pricings error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== GET ZONE PRICING BY ID ====================
router.get('/zone-pricing/:id', 
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const zonePricing = await ZonePricing.findById(req.params.id)
        .populate('zoneFromId', 'name nameAr coordinates')
        .populate('zoneToId', 'name nameAr coordinates')
        .populate('vehicleId', 'name type charge')
        .populate('createdBy', 'username email');
      
      if (!zonePricing) {
        return res.status(404).json({
          success: false,
          message: 'Zone pricing not found'
        });
      }
      
      res.json({
        success: true,
        data: zonePricing
      });
    } catch (error) {
      console.error('Get zone pricing error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== UPDATE ZONE PRICING ====================
router.put('/zone-pricing/:id', 
  // authenticateToken, authorizeAdmin, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { zoneFromId, zoneToId, vehicleId, charge, isActive } = req.body;

         const vehicleExists = await mongoose.model('Car').exists({ _id: vehicleId });

         if (!vehicleExists) {
           return res.status(400).json({   
           success: false,  
            message: 'Invalid vehicleId, vehicle does not exist'
         });

         }

      
      const zonePricing = await ZonePricing.findById(req.params.id);
      if (!zonePricing) {
        return res.status(404).json({
          success: false,
          message: 'Zone pricing not found'
        });
      }
      
      // If zone pair or vehicle is being changed, check for duplicates
      if ((zoneFromId && zoneFromId !== zonePricing.zoneFromId.toString()) ||
          (zoneToId && zoneToId !== zonePricing.zoneToId.toString()) ||
          (vehicleId && vehicleId !== zonePricing.vehicleId.toString())) {
        
        const existingPricing = await ZonePricing.findOne({
          zoneFromId: zoneFromId || zonePricing.zoneFromId,
          zoneToId: zoneToId || zonePricing.zoneToId,
          vehicleId: vehicleId || zonePricing.vehicleId,
          _id: { $ne: req.params.id }
        });
        
        if (existingPricing) {
          return res.status(400).json({
            success: false,
            message: 'Pricing already exists for this zone pair and vehicle'
          });
        }
      }
      
      // Update fields
      if (zoneFromId) zonePricing.zoneFromId = zoneFromId;
      if (zoneToId) zonePricing.zoneToId = zoneToId;
      if (vehicleId) zonePricing.vehicleId = vehicleId;
      if (charge !== undefined) zonePricing.charge = charge;
      if (isActive !== undefined) zonePricing.isActive = isActive;
      
      await zonePricing.save();
      
      await zonePricing.populate([
        { path: 'zoneFromId', select: 'name nameAr' },
        { path: 'zoneToId', select: 'name nameAr' },
        { path: 'vehicleId', select: 'name type' }
      ]);
      
      res.json({
        success: true,
        message: 'Zone pricing updated successfully',
        data: zonePricing
      });
    } catch (error) {
      console.error('Update zone pricing error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== DELETE ZONE PRICING ====================
router.delete('/zone-pricing/:id', 
  // authenticateToken, authorizeAdmin, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const zonePricing = await ZonePricing.findById(req.params.id);
      if (!zonePricing) {
        return res.status(404).json({
          success: false,
          message: 'Zone pricing not found'
        });
      }
      
      await zonePricing.deleteOne();
      
      res.json({
        success: true,
        message: 'Zone pricing deleted successfully'
      });
    } catch (error) {
      console.error('Delete zone pricing error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== GET PRICE BETWEEN ZONES ====================
router.post('/zone-pricing/calculate', 
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { zoneFromId, zoneToId, vehicleId } = req.body;
      
      if (!zoneFromId || !zoneToId || !vehicleId) {
        return res.status(400).json({
          success: false,
          message: 'zoneFromId, zoneToId, and vehicleId are required'
        });
      }
      
      const pricing = await ZonePricing.findOne({
        zoneFromId,
        zoneToId,
        vehicleId,
        isActive: true
      }).populate('zoneFromId zoneToId', 'name nameAr');
      
      if (!pricing) {
        return res.status(404).json({
          success: false,
          message: 'No pricing found for the specified zones and vehicle'
        });
      }
      
      res.json({
        success: true,
        data: {
          charge: pricing.charge,
          zoneFrom: pricing.zoneFromId,
          zoneTo: pricing.zoneToId,
          vehicleId: pricing.vehicleId
        }
      });
    } catch (error) {
      console.error('Calculate price error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== BULK CREATE ZONE PRICINGS ====================
router.post('/zone-pricing/bulk', 
  // authenticateToken, authorizeAdmin, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { pricings } = req.body;
      
      if (!pricings || !Array.isArray(pricings) || pricings.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Pricings array is required'
        });
      }
      
      const createdPricings = [];
      const errors = [];
      
      for (const pricing of pricings) {
        try {
          const { zoneFromId, zoneToId, vehicleId, charge } = pricing;
          
          // Check if exists
          const existing = await ZonePricing.findOne({
            zoneFromId,
            zoneToId,
            vehicleId
          });
          
          if (!existing) {
            const newPricing = new ZonePricing({
              zoneFromId,
              zoneToId,
              vehicleId,
              charge,
              createdBy: req.user?.id || new mongoose.Types.ObjectId()
            });
            
            await newPricing.save();
            createdPricings.push(newPricing);
          } else {
            errors.push({
              pricing,
              error: 'Pricing already exists for this zone pair and vehicle'
            });
          }
        } catch (error) {
          errors.push({
            pricing,
            error: error.message
          });
        }
      }
      
      res.status(201).json({
        success: true,
        message: `Created ${createdPricings.length} zone pricings`,
        data: {
          created: createdPricings,
          errors: errors,
          totalAttempted: pricings.length
        }
      });
    } catch (error) {
      console.error('Bulk create zone pricing error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

// ==================== GET ZONE PRICING SUMMARY ====================
router.get('/zone-pricing/summary/:zoneId', 
  // authenticateToken, // Uncomment when auth is ready
  async (req, res) => {
    try {
      const { zoneId } = req.params;
      
      const outgoingPricings = await ZonePricing.find({ 
        zoneFromId: zoneId, 
        isActive: true 
      })
        .populate('zoneToId', 'name nameAr')
        .populate('vehicleId', 'name type');
      
      const incomingPricings = await ZonePricing.find({ 
        zoneToId: zoneId, 
        isActive: true 
      })
        .populate('zoneFromId', 'name nameAr')
        .populate('vehicleId', 'name type');
      
      res.json({
        success: true,
        data: {
          outgoing: outgoingPricings,
          incoming: incomingPricings,
          summary: {
            totalOutgoing: outgoingPricings.length,
            totalIncoming: incomingPricings.length,
            averageOutgoingCharge: outgoingPricings.length > 0 
              ? outgoingPricings.reduce((sum, p) => sum + p.charge, 0) / outgoingPricings.length 
              : 0
          }
        }
      });
    } catch (error) {
      console.error('Get zone pricing summary error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

module.exports = router;