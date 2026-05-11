const express = require('express');
const router = express.Router();
const { assignBooking, getAvailableDrivers, getAvailableFleets } = require('../controller/bookingAssignmentController');
const { bookingAssignmentSchema } = require('../validations/bookingAssignmentValidation');
const validate = require('../middleware/validateMiddleware');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

/**
 * @route   GET /api/admin/assignments/available-drivers
 * @desc    Get list of available drivers
 * @access  Private (Admin only)
 */
router.get(
  '/available-drivers',
  authenticateToken,
  authorizeAdmin,
  getAvailableDrivers
);

/**
 * @route   GET /api/admin/assignments/available-fleets
 * @desc    Get list of available fleets with GPS
 * @access  Private (Admin only)
 */
router.get(
  '/available-fleets',
  authenticateToken,
  authorizeAdmin,
  getAvailableFleets
);

/**
 * @route   POST /api/admin/assignments/assign
 * @desc    Assign a driver and fleet to a booking (Regular or Hourly)
 * @access  Private (Admin only)
 */
router.post(
  '/assign',
  authenticateToken,
  authorizeAdmin,
  validate(bookingAssignmentSchema),
  assignBooking
);

module.exports = router;
