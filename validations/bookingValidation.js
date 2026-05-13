const { z } = require('zod');
const { objectIdSchema } = require('../utils/validationUtils');
const { BookingCategory } = require('../utils/constants');

const bookingBaseSchema = z.object({
  category: z.enum(Object.values(BookingCategory), {
    errorMap: () => ({ message: `Category must be one of: ${Object.values(BookingCategory).join(', ')}` })
  }),
  cityID: objectIdSchema.optional().nullable(),
  airportID: objectIdSchema.optional().nullable(),
  terminalID: objectIdSchema.optional().nullable(),
  carID: objectIdSchema,

  flightNumber: z.string().optional().nullable(),
  pickupDateTime: z.string().min(1, 'Pickup date and time is required'),

  pickupLat: z.coerce.number({ invalid_type_error: "Pickup Latitude must be a number" }).optional(),
  pickupLong: z.coerce.number({ invalid_type_error: "Pickup Longitude must be a number" }).optional(),
  pickupAddress: z.string().optional(),

  dropOffLat: z.coerce.number({ invalid_type_error: "Dropoff Latitude must be a number" }).optional(),
  dropOffLong: z.coerce.number({ invalid_type_error: "Dropoff Longitude must be a number" }).optional(),
  dropOffAddress: z.string().optional(),

  charge: z.coerce.string().min(1, 'Charge is required'),
  passengerCount: z.coerce.number().min(1, 'At least 1 passenger is required'),
  passengerNames: z.any(),
  passengerMobile: z.string().min(5, 'Valid passenger mobile is required'),
  distance: z.string().optional().nullable(),

  transactionID: z.string().min(1, 'Transaction ID is required'),
  orderID: z.string().min(1, 'Order ID is required'),

  discountPercentage: z.coerce.number().default(0),
  vat: z.coerce.number().default(0),
  allowSimilarVehicle: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),

  specialRequestText: z.string().optional().nullable(),
});


const bookingCreateSchema = bookingBaseSchema.refine((data) => {
  if (data.category === BookingCategory.PRIVATE_TRANSFER) {
    return !!data.cityID;
  } else {
    // AIRPORT_ARRIVAL or AIRPORT_DEPARTURE
    return !!data.terminalID;
  }
}, {
  message: "City ID is required for private transfers, Terminal ID is required for airport transfers",
  path: ["cityID"]
});

const bookingUpdateSchema = bookingBaseSchema.partial();

const hourlyBookingCreateSchema = z.object({
  hours: z.coerce.number().min(1, 'Hours must be at least 1'),
  carID: objectIdSchema,
  cityID: objectIdSchema,
  pickupDateTime: z.string().min(1, 'Pickup date and time is required'),
  pickupLat: z.coerce.number(),
  pickupLong: z.coerce.number(),
  pickupAddress: z.string().min(1, 'Pickup address is required'),
  charge: z.coerce.number().min(1, 'Charge is required'),
  passengerCount: z.coerce.number().min(1, 'At least 1 passenger is required'),
  passengerMobile: z.string().min(5, 'Valid passenger mobile is required'),
  passengerNames: z.any().optional(),
  transactionID: z.string().min(1, 'Transaction ID is required'),
  orderID: z.string().min(1, 'Order ID is required'),
  discountPercentage: z.coerce.number().default(0),
  vat: z.coerce.number().default(0),
  allowSimilarVehicle: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  specialRequestText: z.string().optional().nullable(),
  carClass: z.string().optional(),
});

module.exports = {
  bookingCreateSchema,
  bookingUpdateSchema,
  hourlyBookingCreateSchema
};
