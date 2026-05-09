const axios = require('axios');
const { getRedisClient } = require('../utils/redisClient');

/**
 * Retrieves the Afaqy authentication token from Redis or logs in if missing.
 * @param {boolean} forceRefresh - If true, ignores cache and performs a fresh login.
 */
async function getAfaqyToken(forceRefresh = false) {
    const redisKey = 'afaqy_auth_event-force';
    let redisClient;

    try {
        redisClient = getRedisClient();
    } catch (e) {
        console.error('❌ Redis client not available');
    }

    if (!forceRefresh && redisClient) {
        const cached = await redisClient.get(redisKey);
        if (cached) return JSON.parse(cached).token;
    }

    try {
        const response = await axios.post('https://api.afaqy.sa/auth/login', {
            data: {
                username: process.env.AFAQY_USERNAME,
                password: process.env.AFAQY_PASSWORD
            }
        });

        const token = response.data.token || response.data.data?.token;
        if (!token) throw new Error('Invalid Afaqy response structure');

        if (redisClient) {
            await redisClient.set(redisKey, JSON.stringify({ token }), {
                EX: 9000
            });
        }
        return token;
    } catch (error) {
        console.error('❌ Afaqy Authentication Failed:', error.message);
        throw error;
    }
}

// ─── Shared response mapper ───────────────────────────────────────────────────
const mapUnit = (unit) => ({
    lat: unit.last_update?.lat,
    lng: unit.last_update?.lng,
    speed: unit.last_update?.spd || 0,
    status: unit.last_update?.unit_state?.motion?.state || 'unknown',
    ignition: unit.last_update?.chPrams?.acc?.v === 1,
    odometer: unit.counters?.odometer || 0,
    lastUpdate: unit.last_update?.dts,
    waslStatus: unit.is_wasl_connected
});

/**
 * Fetches live GPS data for a single vehicle by plate number.
 * Uses a flag-based 401 retry: on token expiry, refreshes once and retries.
 */
async function getLiveFleetData(plateNumber) {
    let useFreshToken = false;

    const fetchUnit = async (freshToken) => {
        const token = await getAfaqyToken(freshToken);
        return await axios.post(`https://api.afaqy.sa/units/lists?token=${token}`, {
            data: {
                filters: {
                    name: {
                        value: plateNumber.trim(),
                        op: '='
                    }
                }
            }
        });
    };

    while (true) {
        try {
            const response = await fetchUnit(useFreshToken);

            if (response.data.status_code === 200 && response.data.data?.length > 0) {
                return mapUnit(response.data.data[0]);
            }
            return null;

        } catch (error) {
            if (error.response?.status === 401 && !useFreshToken) {
                console.warn(`⚠️  getLiveFleetData: 401 for ${plateNumber}, refreshing token…`);
                useFreshToken = true;
                continue; // retry once with a fresh token
            }
            console.error(`❌ Afaqy API Error (${plateNumber}):`, error.message);
            return null;
        }
    }
}

/**
 * Fetches ALL live units from Afaqy by paginating through every page.
 * Afaqy's /units/lists is paginated — a single call only returns one page.
 *
 * Strategy:
 *   - Request PAGE_SIZE units per call using `limit` and `page` params.
 *   - Keep fetching until a page returns fewer records than PAGE_SIZE (last page).
 *   - On 401, refresh the token once and retry the current page.
 *   - Returns every unit collected, or [] if the first call fails entirely.
 */
async function getAllLiveFleets() {
    const PAGE_SIZE = 100;
    let allUnits = [];
    let page = 1;
    let useFreshToken = false;

    const fetchPage = async (pageNum, freshToken) => {
        const token = await getAfaqyToken(freshToken);
        return await axios.post(`https://api.afaqy.sa/units/lists?token=${token}`, {
            data: {
                limit: PAGE_SIZE,
                page: pageNum
            }
        });
    };

    while (true) {
        try {
            const response = await fetchPage(page, useFreshToken);

            if (response.data.status_code !== 200) {
                console.error(`❌ getAllLiveFleets: unexpected status ${response.data.status_code} on page ${page}`);
                break;
            }

            const units = response.data.data || [];
            allUnits = allUnits.concat(units);

            // If fewer records returned than requested, this was the last page
            if (units.length < PAGE_SIZE) break;

            page++;
            useFreshToken = false;

        } catch (error) {
            if (error.response?.status === 401 && !useFreshToken) {
                console.warn(`⚠️  getAllLiveFleets: 401 on page ${page}, refreshing token…`);
                useFreshToken = true;
                continue;
            }
            console.error(`❌ getAllLiveFleets: error on page ${page}:`, error.message);
            break;
        }
    }

    return allUnits;
}

module.exports = {
    getLiveFleetData,
    getAllLiveFleets
};
