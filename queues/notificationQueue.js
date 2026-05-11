const { Queue, Worker } = require('bullmq');
const { notifyDriver, notifyUser } = require('../fcm');
const IORedis = require('ioredis');

// 1. Connection setup
const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

// 2. Define the Queue
const notificationQueue = new Queue('notifications', { connection });

// 3. Define the Worker
const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    const { type, recipientId, title, body, data } = job.data;

    console.log(`[Queue] Processing job ${job.id} - Sending ${type} notification to ${recipientId}`);

    try {
      if (type === 'driver') {
        await notifyDriver(recipientId, title, body, data);
      } else if (type === 'user') {
        await notifyUser(recipientId, title, body, data);
      }
      console.log(`[Queue] Job ${job.id} completed successfully`);
    } catch (err) {
      console.error(`[Queue] Job ${job.id} failed:`, err);
      throw err;
    }
  },
  { connection }
);

// Optional: Global error listeners
notificationWorker.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job.id} has failed with ${err.message}`);
});

module.exports = {
  notificationQueue,
};
