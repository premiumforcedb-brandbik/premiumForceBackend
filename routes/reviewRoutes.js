const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Review = require('../models/reviewModel');
const Booking = require('../models/booking_model');
const Driver = require('../models/driver_model');
const User = require('../models/users_model');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');




// ============= CREATE REVIEW =============
// POST /api/reviews - Create a new review (simplified)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { driverID, bookingID, reviewText, rate, isActive } = req.body;


    console.log('Request body:', req.body);

    // Basic validation
    if (!driverID || !bookingID || !reviewText || !rate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate rate
    if (rate < 1 || rate > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rate must be between 1 and 5'
      });
    }

    // Check if review exists
    const existingReview = await Review.findOne({ bookingID });
    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'Review already exists for this booking'
      });
    }

    // Create review with minimal data first
    const reviewData = {
      driverID,
      bookingID,
      reviewText: reviewText.trim(),
      rate: parseInt(rate),
      isActive: isActive !== undefined ? isActive : true,
      createdBy: req.user.id
    };

    console.log('Creating review with data:', reviewData);

    const review = new Review(reviewData);
    await review.save();

    // Fetch the saved review with populated data
    const savedReview = await Review.findById(review._id)
      .populate({ path: 'driverID', select: 'driverName phoneNumber', model: 'Driver' })
      .populate({ path: 'bookingID', select: 'carmodel pickupAddress dropOffAddress charge', model: 'Booking' })
      .populate({ path: 'createdBy', select: 'username email', model: 'User' });

    res.status(201).json({
      success: true,
      message: 'Review created successfully',
      data: savedReview
    });

  } catch (error) {
    console.error('Create review error:', error);
    console.error('Error stack:', error.stack);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Review already exists for this booking'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating review',
      error: error.message,
      stack: error.stack // Temporarily add stack for debugging
    });

  }
});


// ============= GET ALL REVIEWS =============
// GET /api/reviews - Get all reviews with filters
router.get('/', async (req, res) => {
  try {
    const {
      driverID,
      isActive,
      minRate,
      maxRate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (driverID) {
      if (!mongoose.Types.ObjectId.isValid(driverID)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid driver ID format'
        });
      }
      query.driverID = driverID;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (minRate || maxRate) {
      query.rate = {};
      if (minRate) query.rate.$gte = parseInt(minRate);
      if (maxRate) query.rate.$lte = parseInt(maxRate);
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Debugging model names
    console.log('Registered Models:', mongoose.modelNames());

    const reviews = await Review.find(query)
      .populate({ path: 'driverID', select: 'driverName phoneNumber', model: 'Driver' })
      .populate({ path: 'bookingID', select: 'carmodel pickupAddress dropOffAddress charge createdAt', model: 'Booking' })
      .populate({ path: 'createdBy', select: 'username email', model: 'User' })
      .sort(sort)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));


    // ============= DEBUG CODE START =============
    if (reviews.length > 0) {
      const testReview = reviews[0];
      // Fetch raw data (without population) to see the original IDs
      const rawReview = await Review.findById(testReview._id).lean();

      const driverExists = await mongoose.model('Driver').findById(rawReview.driverID);
      const bookingExists = await mongoose.model('Booking').findById(rawReview.bookingID);
      const hourlyExists = await mongoose.model('HourlyBooking').findById(rawReview.bookingID);

      // List all collections
      const collections = await mongoose.connection.db.listCollections().toArray();

      console.log('--- DATABASE DEBUG ---');
      console.log('Registered Models:', mongoose.modelNames());
      console.log('Actual Collections in DB:', collections.map(c => c.name));
      console.log('Review ID:', testReview._id);
      console.log('Raw Driver ID:', rawReview.driverID, 'Found in Drivers:', !!driverExists);
      console.log('Raw Booking ID:', rawReview.bookingID, 'Found in standard Bookings:', !!bookingExists);
      console.log('Raw Booking ID:', rawReview.bookingID, 'Found in HourlyBookings:', !!hourlyExists);
      console.log('-------------------------------');
    }
    // ============= DEBUG CODE END =============

    const total = await Review.countDocuments(query);

    // Calculate average rating
    const avgRating = await Review.aggregate([
      { $match: driverID ? { driverID: new mongoose.Types.ObjectId(driverID) } : {} },
      { $group: { _id: null, average: { $avg: '$rate' } } }
    ]);

    res.json({
      success: true,
      count: reviews.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      averageRating: avgRating[0]?.average || 0,
      data: reviews
    });

  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching reviews',
      error: error.message
    });
  }
});


// ============= GET REVIEW BY ID =============
// GET /api/reviews/:id - Get single review
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID format'
      });
    }

    const review = await Review.findById(req.params.id)
      .populate({ path: 'driverID', select: 'driverName phoneNumber', model: 'Driver' })
      .populate({ path: 'bookingID', select: 'carmodel pickupAddress dropOffAddress charge createdAt', model: 'Booking' })
      .populate({ path: 'createdBy', select: 'username email', model: 'User' });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.json({
      success: true,
      data: review
    });

  } catch (error) {
    console.error('Get review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching review',
      error: error.message
    });
  }
});

// ============= GET REVIEWS BY DRIVER ID =============
// GET /api/reviews/driver/:driverId - Get all reviews for a driver
router.get('/driver/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format'
      });
    }

    const query = {
      driverID: driverId,
      isActive: true
    };

    const reviews = await Review.find(query)
      .populate({ path: 'bookingID', select: 'carmodel pickupAddress dropOffAddress charge', model: 'Booking' })
      .populate({ path: 'createdBy', select: 'username', model: 'User' })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Review.countDocuments(query);

    // Calculate driver rating stats
    const stats = await Review.aggregate([
      { $match: { driverID: new mongoose.Types.ObjectId(driverId), isActive: true } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rate' },
          totalReviews: { $sum: 1 },
          fiveStar: { $sum: { $cond: [{ $eq: ['$rate', 5] }, 1, 0] } },
          fourStar: { $sum: { $cond: [{ $eq: ['$rate', 4] }, 1, 0] } },
          threeStar: { $sum: { $cond: [{ $eq: ['$rate', 3] }, 1, 0] } },
          twoStar: { $sum: { $cond: [{ $eq: ['$rate', 2] }, 1, 0] } },
          oneStar: { $sum: { $cond: [{ $eq: ['$rate', 1] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      success: true,
      count: reviews.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      stats: stats[0] || {
        averageRating: 0,
        totalReviews: 0,
        fiveStar: 0,
        fourStar: 0,
        threeStar: 0,
        twoStar: 0,
        oneStar: 0
      },
      data: reviews
    });

  } catch (error) {
    console.error('Get driver reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver reviews',
      error: error.message
    });
  }
});

// ============= GET REVIEWS BY BOOKING ID =============
// GET /api/reviews/booking/:bookingId - Get review by booking ID
router.get('/booking/:bookingId', async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid booking ID format'
      });
    }

    const review = await Review.findOne({ bookingID: bookingId })
      .populate({ path: 'driverID', select: 'driverName phoneNumber', model: 'Driver' })
      .populate({ path: 'createdBy', select: 'username email', model: 'User' });

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'No review found for this booking'
      });
    }

    res.json({
      success: true,
      data: review
    });

  } catch (error) {
    console.error('Get booking review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking review',
      error: error.message
    });
  }
});

// ============= UPDATE REVIEW =============
// PUT /api/reviews/:id - Update review
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { reviewText, rate, isActive } = req.body;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID format'
      });
    }

    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if user owns this review or is admin
    if (review.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own reviews'
      });
    }

    // Validate rate if provided
    if (rate !== undefined && (rate < 1 || rate > 5)) {
      return res.status(400).json({
        success: false,
        message: 'Rate must be between 1 and 5'
      });
    }

    // Update fields
    if (reviewText) review.reviewText = reviewText.trim();
    if (rate) review.rate = parseInt(rate);
    if (isActive !== undefined) review.isActive = isActive;
    review.updatedAt = Date.now();

    await review.save();

    await review.populate([
      { path: 'driverID', select: 'driverName phoneNumber' },
      { path: 'bookingID', select: 'carmodel pickupAddress dropOffAddress charge' },
      { path: 'createdBy', select: 'username email' }
    ]);

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: review
    });

  } catch (error) {
    console.error('Update review error:', error);

    if (error.name === 'ValidationError') {
      const errors = {};
      for (let field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating review',
      error: error.message
    });
  }
});

// ============= PATCH REVIEW (Partial Update) =============
// PATCH /api/reviews/:id - Partially update review
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID format'
      });
    }

    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if user owns this review or is admin
    if (review.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own reviews'
      });
    }

    const { reviewText, rate, isActive } = req.body;

    // Update only provided fields
    if (reviewText !== undefined) review.reviewText = reviewText.trim();
    if (rate !== undefined) {
      if (rate < 1 || rate > 5) {
        return res.status(400).json({
          success: false,
          message: 'Rate must be between 1 and 5'
        });
      }
      review.rate = parseInt(rate);
    }
    if (isActive !== undefined) review.isActive = isActive;

    review.updatedAt = Date.now();
    await review.save();

    await review.populate([
      { path: 'driverID', select: 'driverName phoneNumber' },
      { path: 'bookingID', select: 'carmodel pickupAddress dropOffAddress charge' },
      { path: 'createdBy', select: 'username email' }
    ]);

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: review
    });

  } catch (error) {
    console.error('Patch review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating review',
      error: error.message
    });
  }
});

// ============= DELETE REVIEW (Soft Delete) =============
// DELETE /api/reviews/:id - Soft delete (set isActive to false)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID format'
      });
    }

    const review = await Review.findById(req.params.id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    // Check if user owns this review or is admin
    if (review.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own reviews'
      });
    }

    // Soft delete - just set isActive to false
    review.isActive = false;
    review.updatedAt = Date.now();
    await review.save();

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });

  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting review',
      error: error.message
    });
  }
});

// ============= HARD DELETE REVIEW (Admin only) =============
// DELETE /api/reviews/:id/hard - Permanently delete review
router.delete('/:id/hard', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid review ID format'
      });
    }

    const review = await Review.findByIdAndDelete(req.params.id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    res.json({
      success: true,
      message: 'Review permanently deleted'
    });

  } catch (error) {
    console.error('Hard delete review error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting review',
      error: error.message
    });
  }
});


// ============= GET SIMPLIFIED DRIVER STATS =============
// GET /api/reviews/driver-stats/:driverId - Get simplified rating stats for a driver
router.get('/driver-stats/:driverId', async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid driver ID format'
      });
    }

    const stats = await Review.aggregate([
      {
        $match: {
          driverID: new mongoose.Types.ObjectId(driverId),
          isActive: true
        }
      },
      {
        $group: {
          _id: '$driverID',
          totalRatingPoints: { $sum: '$rate' },
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rate' }
        }
      }
    ]);

    const data = stats[0] || {
      totalRatingPoints: 0,
      totalReviews: 0,
      averageRating: 0
    };

    res.json({
      success: true,
      data: {
        driverID: driverId,
        totalReviews: data.totalReviews,
        totalRatingPoints: data.totalRatingPoints,
        averageRating: parseFloat(data.averageRating.toFixed(1))
      }
    });

  } catch (error) {
    console.error('Get driver stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver statistics',
      error: error.message
    });
  }
});

module.exports = router;