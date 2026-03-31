// // config/s3Config.js
// const { S3Client } = require('@aws-sdk/client-s3');
// const { Upload } = require('@aws-sdk/lib-storage');
// const multer = require('multer');
// const multerS3 = require('multer-s3');
// const path = require('path');
// const crypto = require('crypto');

// // Debug: Check if environment variables are loaded
// console.log('Loading S3 Config...');
// console.log('AWS_REGION:', process.env.AWS_REGION);
// console.log('AWS_S3_BUCKET_NAME:', process.env.AWS_S3_BUCKET_NAME);
// console.log('AWS_ACCESS_KEY_ID exists:', !!process.env.AWS_ACCESS_KEY_ID);

// // Validate required environment variables
// if (!process.env.AWS_S3_BUCKET_NAME) {
//   console.error('ERROR: AWS_S3_BUCKET_NAME is not defined in environment variables');
//   process.exit(1); // Exit if bucket name is missing
// }

// if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
//   console.error('ERROR: AWS credentials are not defined in environment variables');
//   process.exit(1);
// }

// // Configure S3 client
// const s3Client = new S3Client({
//   region: process.env.AWS_REGION || 'ap-southeast-2',
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
//   }
// });

// // File filter for images only
// const fileFilter = (req, file, cb) => {
//   const allowedTypes = /jpeg|jpg|png|gif|webp/;
//   const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
//   const mimetype = allowedTypes.test(file.mimetype);

//   if (mimetype && extname) {
//     return cb(null, true);
//   } else {
//     cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
//   }
// };

// // Generate unique filename
// const generateFileName = (originalname) => {
//   const timestamp = Date.now();
//   const randomString = crypto.randomBytes(16).toString('hex');
//   const extension = path.extname(originalname);
//   return `profile-images/${timestamp}-${randomString}${extension}`;
// };

// // Configure multer for S3 upload
// console.log('Creating multer S3 storage with bucket:', process.env.AWS_S3_BUCKET_NAME);

// const upload = multer({
//   storage: multerS3({
//     s3: s3Client,
//     bucket: process.env.AWS_S3_BUCKET_NAME,
//     contentType: multerS3.AUTO_CONTENT_TYPE, // THIS IS THE KEY FIX - automatically sets correct Content-Type
//     metadata: (req, file, cb) => {
//       cb(null, { 
//         fieldName: file.fieldname,
//         originalName: file.originalname,
//         contentType: file.mimetype // Store the content type in metadata
//       });
//     },
//     key: (req, file, cb) => {
//       const fileName = generateFileName(file.originalname);
//       console.log('Generated S3 key:', fileName);
//       cb(null, fileName);
//     }
//   }),
//   fileFilter: fileFilter,
//   limits: {
//     fileSize: 5 * 1024 * 1024 // 5MB limit
//   }
// });

// // Function to delete file from S3
// const deleteFromS3 = async (key) => {
//   const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  
//   try {
//     console.log('Deleting from S3:', key);
//     const deleteParams = {
//       Bucket: process.env.AWS_S3_BUCKET_NAME,
//       Key: key
//     };
    
//     const command = new DeleteObjectCommand(deleteParams);
//     await s3Client.send(command);
//     console.log('Successfully deleted from S3:', key);
//     return true;
//   } catch (error) {
//     console.error('Error deleting from S3:', error);
//     throw error;
//   }
// };

// // Generate public URL for S3 object
// const getS3Url = (key) => {
//   return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
// };

// console.log('S3 Config loaded successfully');

// module.exports = {
//   s3Client,
//   upload,
//   deleteFromS3,
//   getS3Url
// };






// config/s3Config.js
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const crypto = require('crypto');

// Debug: Check if environment variables are loaded
console.log('Loading S3 Config...');
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('AWS_S3_BUCKET_NAME:', process.env.AWS_S3_BUCKET_NAME);
console.log('AWS_ACCESS_KEY_ID exists:', !!process.env.AWS_ACCESS_KEY_ID);

// Validate required environment variables
if (!process.env.AWS_S3_BUCKET_NAME) {
  console.error('ERROR: AWS_S3_BUCKET_NAME is not defined in environment variables');
  process.exit(1); // Exit if bucket name is missing
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('ERROR: AWS credentials are not defined in environment variables');
  process.exit(1);
}

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Allowed file types
const allowedImageTypes = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
const allowedAudioTypes = ['mp3', 'wav', 'mp4', 'm4a', 'aac', 'ogg', 'webm', 'flac', 'mpeg'];

// File filter based on field name
const fileFilter = (req, file, cb) => {
  const fieldName = file.fieldname;
  const extname = path.extname(file.originalname).toLowerCase().substring(1);
  const mimetype = file.mimetype;
  
  console.log('File filter check:', { fieldName, extname, mimetype });
  
  // For carimage field - only images
  if (fieldName === 'carimage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for car image (jpeg, jpg, png, gif, webp)'), false);
    }
  }
  // For specialRequestAudio field - only audio files
  else if (fieldName === 'specialRequestAudio') {
    const isAudio = allowedAudioTypes.includes(extname) && 
                   (mimetype.startsWith('audio/') || allowedAudioTypes.includes(extname));
    
    if (isAudio) {
      return cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed (mp3, wav, m4a, aac, ogg, webm, flac)'), false);
    }
  }
  // For profileImage and licenseImage fields - only images
  else if (fieldName === 'profileImage' || fieldName === 'licenseImage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'), false);
    }
  }
  // For any other field - reject
  else {
    cb(new Error(`Unexpected field: ${fieldName}`), false);
  }
};

// Generate unique filename with field-specific folders
const generateFileName = (originalname, fieldName) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(16).toString('hex');
  const extension = path.extname(originalname);
  
  // Different folders for different file types
  let folder = 'uploads';
  if (fieldName === 'carimage') {
    folder = 'bookings/car-images';
  } else if (fieldName === 'specialRequestAudio') {
    folder = 'bookings/audio-requests';
  } else if (fieldName === 'profileImage') {
    folder = 'drivers/profiles';
  } else if (fieldName === 'licenseImage') {
    folder = 'drivers/licenses';
  }
  
  return `${folder}/${timestamp}-${randomString}${extension}`;
};

// Configure multer for S3 upload
console.log('Creating multer S3 storage with bucket:', process.env.AWS_S3_BUCKET_NAME);

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE, // THIS IS THE KEY FIX - automatically sets correct Content-Type
    metadata: (req, file, cb) => {
      cb(null, { 
        fieldName: file.fieldname,
        originalName: file.originalname,
        contentType: file.mimetype,
        fileType: file.fieldname === 'specialRequestAudio' ? 'audio' : 'image'
      });
    },
    key: (req, file, cb) => {
      const fileName = generateFileName(file.originalname, file.fieldname);
      console.log('Generated S3 key:', fileName, 'for field:', file.fieldname);
      cb(null, fileName);
    }
  }),
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for audio files (increased from 5MB)
  }
});

// Function to delete file from S3
const deleteFromS3 = async (key) => {
  try {
    console.log('Deleting from S3:', key);
    const deleteParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key
    };
    
    const command = new DeleteObjectCommand(deleteParams);
    await s3Client.send(command);
    console.log('Successfully deleted from S3:', key);
    return true;
  } catch (error) {
    console.error('Error deleting from S3:', error);
    throw error;
  }
};

// Generate public URL for S3 object
const getS3Url = (key) => {
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-southeast-2'}.amazonaws.com/${key}`;
};

console.log('S3 Config loaded successfully');

module.exports = {
  s3Client,
  upload,
  deleteFromS3,
  getS3Url
};