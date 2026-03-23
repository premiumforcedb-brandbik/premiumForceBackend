const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SpecialID = require('../models/specialIDModel');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');


// @route   GET /api/specialids
// @desc    Get all special IDs
router.get('/', async (req, res) => {
    try {
        const { active, minDiscount, maxDiscount, sort, limit = 50 } = req.query;
        
        let query = {};
        
        // Filter by active status
        if (active !== undefined) {
            query.isActive = active === 'true';
        }
        
        // Filter by discount range
        if (minDiscount || maxDiscount) {
            query.discountPercentage = {};
            if (minDiscount) query.discountPercentage.$gte = parseFloat(minDiscount);
            if (maxDiscount) query.discountPercentage.$lte = parseFloat(maxDiscount);
        }
        
        let specialIDs = SpecialID.find(query);
        
        // Sorting
        if (sort) {
            const sortOrder = sort.startsWith('-') ? -1 : 1;
            const sortField = sort.replace('-', '');
            specialIDs = specialIDs.sort({ [sortField]: sortOrder });
        } else {
            specialIDs = specialIDs.sort({ createdAt: -1 });
        }
        
        // Limit results
        specialIDs = specialIDs.limit(parseInt(limit));
        
        const result = await specialIDs.exec();
        
        res.json({
            success: true,
            count: result.length,
            data: result
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// @route   GET /api/specialids/active
// @desc    Get all active special IDs
router.get('/active', async (req, res) => {
    try {
        const specialIDs = await SpecialID.findActive();
        res.json({
            success: true,
            count: specialIDs.length,
            data: specialIDs
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// @route   GET /api/specialids/:id
// @desc    Get single special ID by ID
router.get('/:id', async (req, res) => {
    try {
        const specialID = await SpecialID.findById(req.params.id);
        
        if (!specialID) {
            return res.status(404).json({ 
                success: false, 
                message: 'Special ID not found' 
            });
        }
        
        res.json({
            success: true,
            data: specialID
        });
    } catch (error) {
        console.error(error);
        
        // Handle invalid ObjectId
        if (error.kind === 'ObjectId') {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid ID format' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// @route   GET /api/specialids/code/:code
// @desc    Get special ID by code
router.get('/code/:code', async (req, res) => {
    try {
        const specialID = await SpecialID.findOne({ 
            code: req.params.code.toUpperCase() 
        });
        
        if (!specialID) {
            return res.status(404).json({ 
                success: false, 
                message: 'Special ID not found' 
            });
        }
        
        res.json({
            success: true,
            data: specialID
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// @route   POST /api/specialids
// @desc    Create new special ID
router.post('/',authenticateToken,authorizeAdmin, async (req, res) => {
    try {
        const { code, text, discountPercentage, usedCount, isActive } = req.body;
        
        // Validate required fields
        if (!code || discountPercentage === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: 'Code and discountPercentage are required' 
            });
        }
        
        // Check if code already exists
        const existingCode = await SpecialID.findOne({ 
            code: code.toUpperCase() 
        });
        
        if (existingCode) {
            return res.status(400).json({ 
                success: false, 
                message: 'Code already exists' 
            });
        }
        
        // Create new special ID
        const specialID = new SpecialID({
            code: code.toUpperCase(),
            text: text || '',
            discountPercentage: parseFloat(discountPercentage),
            usedCount: usedCount || 0,
            isActive: isActive !== undefined ? isActive : true
        });
        
        await specialID.save();
        
        res.status(201).json({
            success: true,
            message: 'Special ID created successfully',
            data: specialID
        });
    } catch (error) {
        console.error(error);
        
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

// @route   PUT /api/specialids/:id
// @desc    Update special ID
router.put('/:id',authenticateToken,authorizeAdmin, async (req, res) => {
    try {
        const { code, text, discountPercentage, usedCount, isActive } = req.body;
        
        // Find and update
        const specialID = await SpecialID.findById(req.params.id);
        
        if (!specialID) {
            return res.status(404).json({ 
                success: false, 
                message: 'Special ID not found' 
            });
        }
        
        // Check if code is being changed and if it already exists
        if (code && code.toUpperCase() !== specialID.code) {
            const existingCode = await SpecialID.findOne({ 
                code: code.toUpperCase(),
                _id: { $ne: req.params.id }
            });
            
            if (existingCode) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Code already exists' 
                });
            }
        }
        
        // Update fields
        if (code) specialID.code = code.toUpperCase();
        if (text !== undefined) specialID.text = text;
        if (discountPercentage !== undefined) {
            specialID.discountPercentage = parseFloat(discountPercentage);
        }
        if (usedCount !== undefined) specialID.usedCount = usedCount;
        if (isActive !== undefined) specialID.isActive = isActive;
        
        await specialID.save();
        
        res.json({
            success: true,
            message: 'Special ID updated successfully',
            data: specialID
        });
    } catch (error) {
        console.error(error);
        
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


// @route   PATCH /api/specialids/:id/increment
// @desc    Increment used count
router.patch('/:id/increment', async (req, res) => {
    try {
        const specialID = await SpecialID.findById(req.params.id);
        
        if (!specialID) {
            return res.status(404).json({ 
                success: false, 
                message: 'Special ID not found' 
            });
        }
        
        if (!specialID.isActive) {
            return res.status(400).json({ 
                success: false, 
                message: 'Special ID is not active' 
            });
        }
        
        await specialID.incrementUsedCount();
        
        res.json({
            success: true,
            message: 'Used count incremented successfully',
            data: specialID
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// @route   DELETE /api/specialids/:id
// @desc    Delete special ID
router.delete('/:id', async (req, res) => {
    try {
        const specialID = await SpecialID.findByIdAndDelete(req.params.id);
        
        if (!specialID) {
            return res.status(404).json({ 
                success: false, 
                message: 'Special ID not found' 
            });
        }
        
        res.json({
            success: true,
            message: 'Special ID deleted successfully'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

// @route   PATCH /api/specialids/:id/toggle
// @desc    Toggle active status
router.patch('/:id/toggle', async (req, res) => {
    try {
        const specialID = await SpecialID.findById(req.params.id);
        
        if (!specialID) {
            return res.status(404).json({ 
                success: false, 
                message: 'Special ID not found' 
            });
        }
        
        specialID.isActive = !specialID.isActive;
        await specialID.save();
        
        res.json({
            success: true,
            message: `Special ID ${specialID.isActive ? 'activated' : 'deactivated'} successfully`,
            data: specialID
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error', 
            error: error.message 
        });
    }
});

module.exports = router;