
/**
 * Adds a cityID constraint to the query for dispatchers.
 * For non-dispatchers this is a no-op and baseQuery is returned as-is.
 *
 * @param {Object|null} admin    - req.admin (populated by authorizeAdmin middleware)
 * @param {Object} baseQuery     - Filters already built in the route handler
 * @returns {Object}             - A Mongoose-compatible query object
 */
function applyDispatcherCityFilter(admin, baseQuery) {
  // Non-dispatcher: no restriction
  if (!admin || admin.accessLevel !== 1) {
    return baseQuery;
  }

  // Dispatcher with no city assigned: return empty result set
  const cityObjectId = admin.cityID?._id ?? admin.cityID;
  if (!cityObjectId) {
    console.warn(`[CityFilter] Dispatcher ${admin._id} has no cityID assigned.`);
    return { _id: { $in: [] } };
  }

  // Restrict to the dispatcher's city
  return { ...baseQuery, cityID: cityObjectId };
}

module.exports = { applyDispatcherCityFilter };
