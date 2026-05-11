const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
  message: 'Invalid ObjectId format',
});

const bookingAssignmentSchema = z.object({
  bookingID: objectIdSchema,
  driverID: objectIdSchema,
  fleetID: objectIdSchema,
  bookingType: z.enum(['regular', 'hourly']),
});

module.exports = {
  bookingAssignmentSchema,
};
