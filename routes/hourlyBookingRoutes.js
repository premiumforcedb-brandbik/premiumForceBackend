const express = require('express');
const router = express.Router();
const { upload } = require('../config/s3config');
const { authenticateCustomer } = require('../middleware/customermiddleware');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');
const bookingController = require('../controller/bookingController');
const validate = require('../middleware/validateMiddleware');
const { hourlyBookingCreateSchema } = require('../validations/bookingValidation');

// ============= CUSTOMER ENDPOINTS =============

// POST /api/hourly-bookings - Create hourly booking
router.post('/',
  authenticateCustomer,
  upload.fields([{ name: 'specialRequestAudio', maxCount: 1 }]),
  validate(hourlyBookingCreateSchema),
  bookingController.createHourlyBooking
);

// PUT /api/hourly-bookings/:id - Update hourly booking
router.put('/:id',
  authenticateCustomer,
  upload.fields([{ name: 'specialRequestAudio', maxCount: 1 }]),
  bookingController.updateHourlyBooking
);

// ============= ADMIN ENDPOINTS =============

// GET /api/hourly-bookings/admin/list - Get all hourly bookings
router.get('/admin/list',
  authenticateToken,
  authorizeAdmin,
  bookingController.getAllHourlyBookings
);

// GET /api/hourly-bookings/:id - Get hourly booking by ID
router.get('/:id',
  authenticateToken,
  bookingController.getHourlyBookingById
);

module.exports = router;