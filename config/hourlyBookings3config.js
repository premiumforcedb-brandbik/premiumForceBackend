const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
require('dotenv').config();

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const s3 = new AWS.S3();

// IMPORTANT: Check if bucket name is configured
if (!process.env.AWS_S3_BUCKET_NAME) {
  console.error('AWS_S3_BUCKET_NAME is not defined in environment variables');
}

// Configure multer for memory storage first (for debugging)
const storage = multer.memoryStorage();

// Create multer upload instance with proper configuration
const upload = multer({
  storage: storage, // Use memory storage first to isolate the issue
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 2 // Maximum 2 files
  },
  fileFilter: (req, file, cb) => {
    console.log('File filter - received file:', file.fieldname, file.mimetype);
    
    // Accept only specific field names
    if (file.fieldname === 'carImage' || file.fieldname === 'specialRequestAudio') {
      // Validate file types
      if (file.fieldname === 'carImage') {
        // Accept images
        if (file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error('carImage must be an image file'));
        }
      } else if (file.fieldname === 'specialRequestAudio') {
        // Accept audio files
        if (file.mimetype.startsWith('audio/')) {
          cb(null, true);
        } else {
          cb(new Error('specialRequestAudio must be an audio file'));
        }
      }
    } else {
      console.log('Rejected field:', file.fieldname);
      cb(new Error(`Unexpected field: ${file.fieldname}`));
    }
  }
});

// S3 upload function (we'll implement this after fixing the basic multer issue)
const uploadToS3 = async (file, folder) => {
  // This will be implemented later
  return null;
};

const deleteFromS3 = async (key) => {
  // This will be implemented later
  console.log('Would delete from S3:', key);
  return true;
};

const getS3Url = (key) => {
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

const extractKeyFromUrl = (url) => {
  if (!url) return null;
  const parts = url.split('.amazonaws.com/');
  return parts.length > 1 ? parts[1] : null;
};

module.exports = {
  upload,
  deleteFromS3,
  getS3Url,
  extractKeyFromUrl
};