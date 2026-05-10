const z = require('../utils/zodUtils');


const createBookingSchema = z.object({

    // Category And Location
    categoryId: z.objectId(),
    cityId: z.objectId(),
    airportId: z.optionalObjectId(),
    terminalId: z.optionalObjectId(),

    // Time And Flight
    flightNumber: z.string().trim().optional(),
    arrival: z.coerce.date(),

    // Pick Up And Drop Off
    pickupLat: z.coerce.number(),
    pickupLong: z.coerce.number(),
    pickupAddress: z.string().trim(),
    dropOffLat: z.coerce.number(),
    dropOffLong: z.coerce.number(),
    dropOffAddress: z.string().trim(),

    // Booking Details
    specialRequestText: z.string().trim().optional(),
    passengerCount: z.coerce.number(),
    passengerNames: z.string().trim().optional(),
    passengerMobile: z.string().trim(),
    distance: z.string().trim(),
    charge: z.coerce.number(),

    // Files
    specialRequestAudio: z.string().trim().optional(),


})


module.exports = { createBookingSchema }