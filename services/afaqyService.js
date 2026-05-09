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

/**
 * Fetches live data for a vehicle with automatic 401 retry mechanism.
 */
async function getLiveFleetData(plateNumber) {
    // Inner function to allow a single retry on 401
    const executeFetch = async (useFreshToken = false) => {
        const token = await getAfaqyToken(useFreshToken);

        return await axios.post(`https://api.afaqy.sa/units/lists?token=${token}`, {
            data: {
                filters: {
                    name: {
                        value: plateNumber.trim(),
                        op: "="
                    }
                }
            }
        });
    };

    try {
        // Initial attempt
        let response = await executeFetch(false);

        // Success check
        if (response.data.status_code === 200 && response.data.data?.length > 0) {
            const unit = response.data.data[0];
            return {
                lat: unit.last_update?.lat,
                lng: unit.last_update?.lng,
                speed: unit.last_update?.spd || 0,
                status: unit.last_update?.unit_state?.motion?.state || 'unknown',
                ignition: unit.last_update?.chPrams?.acc?.v === 1,
                odometer: unit.counters?.odometer || 0,
                lastUpdate: unit.last_update?.dts,
                waslStatus: unit.is_wasl_connected
            };
        }
        return null;

    } catch (error) {

        if (error.response?.status === 401) {

            try {
                const retryResponse = await executeFetch(true);

                if (retryResponse.data.status_code === 200 && retryResponse.data.data?.length > 0) {
                    const unit = retryResponse.data.data[0];
                    return {
                        lat: unit.last_update?.lat,
                        lng: unit.last_update?.lng,
                        speed: unit.last_update?.spd || 0,
                        status: unit.last_update?.unit_state?.motion?.state || 'unknown',
                        ignition: unit.last_update?.chPrams?.acc?.v === 1,
                        odometer: unit.counters?.odometer || 0,
                        lastUpdate: unit.last_update?.dts,
                        waslStatus: unit.is_wasl_connected
                    };
                }
            } catch (retryError) {
                console.error(`❌ Retry failed for ${plateNumber}:`, retryError.message);
            }
        }

        console.error(`❌ Afaqy API Error (${plateNumber}):`, error.message);
        return null;
    }
}

module.exports = {
    getLiveFleetData
};
