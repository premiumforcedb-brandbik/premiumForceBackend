const { createClient } = require('redis');

let redisClient = null;

/**
 * Returns the singleton Redis client.
 */
const getRedisClient = () => {
    if (!redisClient) {
        throw new Error('Redis client not initialized. Call connectRedis() on server startup first.');
    }
    return redisClient;
};

/**
 * Connect to Redis eagerly at server startup.
 */
const connectRedis = async () => {
    if (redisClient) return;

    redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
        socket: {
            reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
        }
    });

    redisClient.on('connect', () => console.log('✅ Redis client connected'));
    redisClient.on('error', (err) => {
        if (err.code !== 'ECONNREFUSED') console.error(`❌ Redis client error: ${err.message}`);
    });
    redisClient.on('end', () => console.warn('⚠️ Redis client connection closed'));

    try {
        await redisClient.connect();
    } catch (err) {
        console.error('❌ Failed to connect to Redis on startup:', err.message);
    }
};

/**
 * Gracefully disconnect Redis.
 */
const closeRedis = async () => {
    if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        console.log('✅ Redis client disconnected');
    }
};

module.exports = {
    connectRedis,
    getRedisClient,
    closeRedis
};
