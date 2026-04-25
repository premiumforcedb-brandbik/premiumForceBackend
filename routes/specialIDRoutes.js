const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SpecialID = require('../models/specialIDModel');
const User = require('../models/users_model'); // Added User model
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');
const Company = require('../models/companyModel');




// ============= PROMO CODE USAGE API =============
// @route   GET /api/specialids/promocode-usage
// @desc    Get all users who have applied a promo code with details
router.get('/promocode-usage',
    // authenticateToken, authorizeAdmin,

    async (req, res) => {
        try {
            const { userStatus, page = 1, limit = 20 } = req.query;

            const skipPage = (parseInt(page) - 1) * parseInt(limit);
            const limitPage = parseInt(limit);

            // Build match stage: list users if specialId is not null or empty
            let userMatch = {
                specialId: { $ne: null, $exists: true, $ne: "" }
            };

            // Smart filter to handle both new and legacy status values
            if (userStatus === 'approved') {
                userMatch.isDiscountApproved = { $in: ["approved", "true", true] };
            } else if (userStatus === 'rejected') {
                userMatch.isDiscountApproved = { $in: ["rejected", "false", false] };
            } else if (userStatus === 'pending') {
                userMatch.isDiscountApproved = "pending";
            }

            const aggregation = [
                { $match: userMatch },
                // Join with SpecialID collection
                {
                    $lookup: {
                        from: "specialidmodels",
                        localField: "specialId",
                        foreignField: "code",
                        as: "promoDetails"
                    }
                },
                // Use preserveNullAndEmptyArrays: true so users aren't hidden if code is missing/invalid
                {
                    $unwind: {
                        path: "$promoDetails",
                        preserveNullAndEmptyArrays: true
                    }
                },
                // Calculate derived fields
                {
                    $addFields: {
                        isDiscountApplicable: {
                            $and: [
                                { $in: ["$isDiscountApproved", ["approved", "true", true]] },
                                { $ifNull: ["$promoDetails.isActive", false] } // Fallback to false if promo missing
                            ]
                        }
                    }
                },
                // Project the fields needed
                {
                    $project: {
                        _id: 1,
                        username: 1,
                        email: 1,
                        companyMail: 1,
                        phoneNumber: 1,
                        countryCode: 1,
                        isDiscountApproved: { $in: ["$isDiscountApproved", ["approved", "true", true]] },
                        isDiscountApprovedAt: 1,
                        specialId: 1,
                        promoDetails: 1,
                        usedAt: "$updatedAt",
                        usageStatus: {
                            $switch: {
                                branches: [
                                    { case: { $in: ["$isDiscountApproved", ["approved", "true", true]] }, then: "approved" },
                                    { case: { $in: ["$isDiscountApproved", ["rejected", "false", false]] }, then: "rejected" }
                                ],
                                default: "pending"
                            }
                        },
                        isDiscountApplicable: 1
                    }
                },


                // Facet for pagination
                {
                    $facet: {
                        metadata: [{ $count: "total" }],
                        data: [{ $skip: skipPage }, { $limit: limitPage }]
                    }
                }
            ];

            const result = await User.aggregate(aggregation);

            const totalItems = result[0].metadata[0] ? result[0].metadata[0].total : 0;
            const data = result[0].data;

            res.json({
                success: true,
                pagination: {
                    totalItems,
                    totalPages: Math.ceil(totalItems / limitPage),
                    currentPage: parseInt(page),
                    itemsPerPage: limitPage
                },
                data
            });

        } catch (error) {
            console.error('PROMO USAGE error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
                error: error.message
            });
        }
    });





// ============= GET ALL SPECIAL IDs =============
// @route   GET /api/specialids
// @desc    Get all special IDs with filters
router.get('/',
    authenticateToken, authorizeAdmin,
    async (req, res) => {
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

            let specialIDsQuery = SpecialID.find(query).populate('companyID');

            // Sorting
            if (sort) {
                const sortOrder = sort.startsWith('-') ? -1 : 1;
                const sortField = sort.replace('-', '');
                specialIDsQuery = specialIDsQuery.sort({ [sortField]: sortOrder });
            } else {
                specialIDsQuery = specialIDsQuery.sort({ createdAt: -1 });
            }

            // Limit results
            specialIDsQuery = specialIDsQuery.limit(parseInt(limit));

            const result = await specialIDsQuery.exec();

            res.json({
                success: true,
                count: result.length,
                data: result
            });
        } catch (error) {
            console.error('GET all error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error',
                error: error.message
            });
        }
    });

// ============= GET ACTIVE SPECIAL IDs =============
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
        console.error('GET active error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ============= GET SPECIAL ID BY ID =============
// @route   GET /api/specialids/:id
// @desc    Get single special ID by ID
router.get('/:id',
    authenticateToken, authorizeAdmin,
    async (req, res) => {
        try {
            const specialID = await SpecialID.findById(req.params.id);
            const company = await Company.findById(specialID.companyID);
            if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid ID format'
                });
            }
            if (!specialID) {
                return res.status(404).json({
                    success: false,
                    message: 'Special ID not found'
                });
            }
            var data = {
                specialID: specialID,
                company: company
            };

            res.json({
                success: true,
                data: data,

            });
        } catch (error) {
            console.error('GET by ID error:', error);

            // Handle invalid ObjectId
            if (error.kind === 'ObjectId' || error.name === 'CastError') {
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

// ============= GET SPECIAL ID BY CODE =============
// @route   GET /api/specialids/code/:code
// @desc    Get special ID by code (public endpoint)
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
        console.error('GET by code error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ============= CREATE SPECIAL ID =============
// @route   POST /api/specialids
// @desc    Create new special ID (Admin only)
router.post('/', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { code, companyID, text, discountPercentage, usedCount, maxUsage, isActive } = req.body;

        if (!companyID) {
            return res.status(400).json({
                success: false,
                message: 'Company ID is required'
            });
        }
        if (!mongoose.Types.ObjectId.isValid(companyID)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid company ID'
            });
        }
        // Validate required fields
        if (!code || discountPercentage === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Code and discountPercentage are required'
            });
        }

        // Validate discount percentage
        const discount = parseFloat(discountPercentage);
        if (isNaN(discount) || discount < 0 || discount > 100) {
            return res.status(400).json({
                success: false,
                message: 'Discount percentage must be a number between 0 and 100'
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
            companyID: companyID,
            discountPercentage: discount,
            maxUsage: maxUsage || null,
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
        console.error('Create error:', error);

        // Handle duplicate key error
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Code already exists'
            });
        }

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

// ============= UPDATE SPECIAL ID =============
// @route   PUT /api/specialids/:id
// @desc    Update special ID (Admin only)
// authenticateToken, authorizeAdmin,
router.put('/:id',
    authenticateToken, authorizeAdmin,
    async (req, res) => {
        try {
            const { code, text, companyID,
                discountPercentage, usedCount, maxUsage, isActive } = req.body;

            // Find the special ID
            const specialID = await SpecialID.findById(req.params.id);

            if (!specialID) {
                return res.status(404).json({
                    success: false,
                    message: 'Special ID not found'
                });
            }
            if (!mongoose.Types.ObjectId.isValid(companyID)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid company ID'
                });
            }
            // Validate discount percentage if provided
            if (discountPercentage !== undefined) {
                const discount = parseFloat(discountPercentage);
                if (isNaN(discount) || discount < 0 || discount > 100) {
                    return res.status(400).json({
                        success: false,
                        message: 'Discount percentage must be a number between 0 and 100'
                    });
                }
                specialID.discountPercentage = discount;
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
                specialID.code = code.toUpperCase();
            }

            // Update fields
            if (text !== undefined) specialID.text = text;
            if (usedCount !== undefined) {
                if (usedCount < 0) {
                    return res.status(400).json({
                        success: false,
                        message: 'Used count cannot be negative'
                    });
                }
                specialID.usedCount = usedCount;

            }

            if (isActive !== undefined) specialID.isActive = isActive;
            specialID.companyID = companyID;
            if (maxUsage !== undefined) specialID.maxUsage = maxUsage || null;
            await specialID.save();

            res.json({
                success: true,
                message: 'Special ID updated successfully',
                data: specialID
            });


        } catch (error) {
            console.error('Update error:', error);

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

// ============= INCREMENT USED COUNT =============
// @route   PATCH /api/specialids/:id/increment
// @desc    Increment used count
router.patch('/:id/increment', async (req, res) => {
    try {
        // Change parameter name to 'amount' to avoid confusion with database field
        const { usedCount = 1 } = req.body;

        // Validate amount
        if (typeof usedCount !== 'number' || isNaN(usedCount)) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be a valid number'
            });
        }

        if (usedCount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be greater than 0'
            });
        }

        // Find the special ID
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
                message: 'Cannot increment inactive special ID'
            });
        }

        // Save the previous count
        const previousCount = specialID.usedCount;

        // Manual increment (more reliable)
        specialID.usedCount += usedCount;
        await specialID.save();

        res.json({
            success: true,
            message: `Used count incremented by ${usedCount}`,
            data: {
                id: specialID._id,
                code: specialID.code,
                usedCount: specialID.usedCount,
                previousCount: previousCount,
                discountPercentage: specialID.discountPercentage,
                isActive: specialID.isActive
            }
        });

    } catch (error) {
        console.error('Increment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ============= DECREMENT USED COUNT =============
// @route   PATCH /api/specialids/:id/decrement
// @desc    Decrement used count (Admin only)
router.patch('/:id/decrement', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { amount = 1 } = req.body;

        // Validate amount
        if (typeof amount !== 'number' || isNaN(amount)) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be a valid number'
            });
        }

        if (amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be greater than 0'
            });
        }

        // Find the special ID
        const specialID = await SpecialID.findById(req.params.id);

        if (!specialID) {
            return res.status(404).json({
                success: false,
                message: 'Special ID not found'
            });
        }

        // Save the previous count
        const previousCount = specialID.usedCount;

        // Check if decrement would go below 0
        if (specialID.usedCount - amount < 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot decrement below 0. Current count: ${specialID.usedCount}`
            });
        }

        // Decrement and save
        await specialID.decrementUsedCount(amount);

        // Fetch the updated document
        const updatedSpecialID = await SpecialID.findById(req.params.id);

        res.json({
            success: true,
            message: `Used count decremented by ${amount}`,
            data: {
                id: updatedSpecialID._id,
                code: updatedSpecialID.code,
                usedCount: updatedSpecialID.usedCount,
                previousCount: previousCount,
                discountPercentage: updatedSpecialID.discountPercentage,
                isActive: updatedSpecialID.isActive
            }
        });

    } catch (error) {
        console.error('Decrement error:', error);

        if (error.message === 'Used count cannot be negative') {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ============= RESET USED COUNT =============
// @route   PATCH /api/specialids/:id/reset
// @desc    Reset used count to 0 (Admin only)
router.patch('/:id/reset', authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        // Find the special ID
        const specialID = await SpecialID.findById(req.params.id);

        if (!specialID) {
            return res.status(404).json({
                success: false,
                message: 'Special ID not found'
            });
        }

        const previousCount = specialID.usedCount;

        // Reset used count
        specialID.usedCount = 0;
        await specialID.save();

        res.json({
            success: true,
            message: 'Used count reset to 0',
            data: {
                id: specialID._id,
                code: specialID.code,
                usedCount: specialID.usedCount,
                previousCount: previousCount,
                discountPercentage: specialID.discountPercentage,
                isActive: specialID.isActive
            }
        });

    } catch (error) {
        console.error('Reset error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ============= TOGGLE ACTIVE STATUS =============
// @route   PATCH /api/specialids/:id/toggle
// @desc    Toggle active status (Admin only)
router.patch('/:id/toggle', authenticateToken, authorizeAdmin, async (req, res) => {
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
        console.error('Toggle error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

// ============= DELETE SPECIAL ID =============
// @route   DELETE /api/specialids/:id
// @desc    Delete special ID (Admin only)
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
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
            message: 'Special ID deleted successfully',
            data: {
                id: specialID._id,
                code: specialID.code
            }
        });
    } catch (error) {
        console.error('Delete error:', error);

        if (error.name === 'CastError') {
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

module.exports = router;