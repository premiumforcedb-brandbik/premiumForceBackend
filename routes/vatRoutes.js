const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Vat = require('../models/vatModel');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');


// ============= GET VAT VALUE =============
// @route   GET /api/vat
// @desc    Get current VAT value
router.get('/', async (req, res) => {
    try {
        const vat = await Vat.getVat();
        
        res.json({
            success: true,
            data: {
                vat: vat.vat
            }
        });
    } catch (error) {
        console.error('GET VAT error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// ============= ADD OR UPDATE VAT =============
// @route   POST /api/vat
// @desc    Add or update VAT value (Admin only)
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { vat } = req.body;
        
        // Validate input
        if (vat === undefined || vat === null) {
            return res.status(400).json({ 
                success: false, 
                message: 'VAT value is required' 
            });
        }
        
        const vatValue = Number(vat);
        
        if (isNaN(vatValue)) {
            return res.status(400).json({ 
                success: false, 
                message: 'VAT must be a valid number' 
            });
        }
        
        if (vatValue < 0 || vatValue > 100) {
            return res.status(400).json({ 
                success: false, 
                message: 'VAT must be between 0 and 100' 
            });
        }
        
        // Check if VAT exists
        const existingVat = await Vat.findOne();
        let updatedVat;
        let action;
        
        if (!existingVat) {
            // Create new VAT
            updatedVat = await Vat.create({ vat: vatValue });
            action = 'added';
        } else {
            // Update existing VAT
            existingVat.vat = vatValue;
            updatedVat = await existingVat.save();
            action = 'updated';
        }
        
        res.status(201).json({
            success: true,
            message: `VAT ${action} successfully`,
            data: {
                vat: updatedVat.vat,
                updatedAt: updatedVat.updatedAt
            }
        });
        
    } catch (error) {
        console.error('Add/Update VAT error:', error);
        
        // Handle validation errors
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ 
                success: false, 
                message: 'Validation error', 
                errors: messages 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// ============= UPDATE VAT VALUE =============
// @route   PUT /api/vat
// @desc    Update VAT value (Admin only)
router.put('/', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { vat } = req.body;
        
        // Validate input
        if (vat === undefined || vat === null) {
            return res.status(400).json({ 
                success: false, 
                message: 'VAT value is required' 
            });
        }
        
        const vatValue = Number(vat);
        
        if (isNaN(vatValue)) {
            return res.status(400).json({ 
                success: false, 
                message: 'VAT must be a valid number' 
            });
        }
        
        if (vatValue < 0 || vatValue > 100) {
            return res.status(400).json({ 
                success: false, 
                message: 'VAT must be between 0 and 100' 
            });
        }
        
        // Find and update VAT
        const vatRecord = await Vat.findOne();
        
        if (!vatRecord) {
            return res.status(404).json({ 
                success: false, 
                message: 'VAT record not found. Please use POST to create first.' 
            });
        }
        
        const previousValue = vatRecord.vat;
        vatRecord.vat = vatValue;
        await vatRecord.save();
        
        res.json({
            success: true,
            message: 'VAT updated successfully',
            data: {
                previousValue: previousValue,
                currentValue: vatRecord.vat,
                updatedAt: vatRecord.updatedAt
            }
        });
        
    } catch (error) {
        console.error('Update VAT error:', error);
        
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(e => e.message);
            return res.status(400).json({ 
                success: false, 
                message: 'Validation error', 
                errors: messages 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});




module.exports = router;