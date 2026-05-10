// utils/zod.utils.js
const { z } = require('zod')
const { Types } = require('mongoose')

const customZ = {
    ...z,
    objectId: () => z.string().refine((val) => Types.ObjectId.isValid(val), { message: 'Invalid ObjectId' }),
    optionalObjectId: () => z.string().refine((val) => Types.ObjectId.isValid(val), { message: 'Invalid ObjectId' }).optional(),
    futureDate: () => z.coerce.date().refine((d) => d > new Date(), { message: 'Date must be in the future' }),
    saudiPhone: () => z.string().regex(/^(\+966|0)(5\d{8})$/, 'Invalid Saudi phone number'),
    nonEmptyString: () => z.string().min(1).trim(),
    namesArray: () => z.string().regex(/^[\u0600-\u06FFa-zA-Z\s]+(,[\u0600-\u06FFa-zA-Z\s]+)*$/, 'Names must be comma-separated'),
}

module.exports = customZ