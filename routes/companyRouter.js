const express = require('express');
const Company = require('../models/companyModel');
// const jwt = require('jsonwebtoken');

const router = express.Router();
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');




// CREATE - Add new company
router.post('/',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
        try {
            const { name, text, isActive } = req.body;

            const company = new Company({
                name: name.toUpperCase(),
                text: text || '',
                isActive: isActive !== undefined ? isActive : true
            });

            await company.save();

            res.status(201).json({
                success: true,
                message: 'Company created successfully',
                data: company
            });
        } catch (error) {
            if (error.code === 11000) {
                res.status(400).json({
                    success: false,
                    message: 'Company name already exists'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: error.message
                });
            }
        }
    });

// READ ALL - Get all companies with pagination
router.get('/',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
        try {
            // Pagination parameters
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            // Filter by active status
            let filter = {};
            if (req.query.isActive) {
                filter.isActive = req.query.isActive === 'true';
            }

            // Search by name
            if (req.query.search) {
                filter.name = { $regex: req.query.search, $options: 'i' };
            }

            // Get total count
            const total = await Company.countDocuments(filter);

            // Get companies with pagination
            const companies = await Company.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);

            res.json({
                success: true,
                data: companies,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    itemsPerPage: limit,
                    hasNext: page < Math.ceil(total / limit),
                    hasPrev: page > 1
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    });

// READ ONE - Get single company by ID
router.get('/:id',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
        try {
            const company = await Company.findById(req.params.id);

            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found'
                });
            }

            res.json({
                success: true,
                data: company
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Invalid company ID'
            });
        }
    });

// UPDATE - Update company
router.put('/:id',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
        try {
            const { name, text, isActive } = req.body;

            const updateData = {};
            if (name) updateData.name = name.toUpperCase();
            if (text !== undefined) updateData.text = text;
            if (isActive !== undefined) updateData.isActive = isActive;

            const company = await Company.findByIdAndUpdate(
                req.params.id,
                updateData,
                { new: true, runValidators: true }
            );

            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found'
                });
            }

            res.json({
                success: true,
                message: 'Company updated successfully',
                data: company
            });
        } catch (error) {
            if (error.code === 11000) {
                res.status(400).json({
                    success: false,
                    message: 'Company name already exists'
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: error.message
                });
            }
        }
    });

// DELETE - Delete company
router.delete('/:id',
    authenticateToken,
    authorizeAdmin,
    async (req, res) => {
        try {
            const company = await Company.findByIdAndDelete(req.params.id);

            if (!company) {
                return res.status(404).json({
                    success: false,
                    message: 'Company not found'
                });
            }

            res.json({
                success: true,
                message: 'Company deleted successfully'
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    });

module.exports = router;


