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
const allowedImageTypes = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'svg'];
const allowedAudioTypes = ['mp3', 'wav', 'mp4', 'm4a', 'aac', 'ogg', 'webm', 'flac', 'mpeg'];

// File filter based on field name
const fileFilter = (req, file, cb) => {
  const fieldName = file.fieldname;
  const extname = path.extname(file.originalname).toLowerCase().substring(1);
  const mimetype = file.mimetype;
  
  console.log('File filter check:', { fieldName, extname, mimetype });
  
  // For user profile image
  if (fieldName === 'profileImage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for profile image (jpeg, jpg, png, gif, webp)'), false);
    }
  }
  // For terminal image
  else if (fieldName === 'image') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for terminal image (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  }
  // For banner English image
  else if (fieldName === 'image') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for banner English image (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  }
  // For banner Arabic image
  else if (fieldName === 'imageAr') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for banner Arabic image (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  }
  // For model/collection icon
  else if (fieldName === 'icon') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for icon (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  }
  // For hourly booking car image
  else if (fieldName === 'carImage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for car image (jpeg, jpg, png, gif, webp)'), false);
    }
  }
  // For hourly booking special request audio
  else if (fieldName === 'specialRequestAudio') {
    const isAudio = allowedAudioTypes.includes(extname) && 
                   (mimetype.startsWith('audio/') || allowedAudioTypes.includes(extname));
    
    if (isAudio) {
      return cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed (mp3, wav, m4a, aac, ogg, webm, flac)'), false);
    }
  }
  // For driver license image
  else if (fieldName === 'licenseImage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for license image (jpeg, jpg, png, gif, webp)'), false);
    }
  }
  // For city image
  else if (fieldName === 'cityImage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for city image (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  }
  // For category image
  else if (fieldName === 'categoryImage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for category image (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  }
  // For regular booking car image
  else if (fieldName === 'carimage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for car image (jpeg, jpg, png, gif, webp)'), false);
    }
  }
  // For airport image
  else if (fieldName === 'airportImage') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for airport (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  }
  // For brandIcon field - only images
  else if (fieldName === 'brandIcon') {
    const isImage = allowedImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedImageTypes.includes(extname));
    
    if (isImage) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for brand icon (jpeg, jpg, png, gif, webp, svg)'), false);
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
  
  if (fieldName === 'profileImage') {
    folder = 'users/profiles';
  } else if (fieldName === 'image') {
    folder = 'terminals/images';
  } else if (fieldName === 'bannerImage') {
    folder = 'banners/english-images';
  } else if (fieldName === 'bannerImageAr') {
    folder = 'banners/arabic-images';
  } else if (fieldName === 'icon') {
    folder = 'models/icons';
  } else if (fieldName === 'carImage') {
    folder = 'hourly-bookings/car-images';
  } else if (fieldName === 'specialRequestAudio') {
    folder = 'hourly-bookings/audio-requests';
  } else if (fieldName === 'licenseImage') {
    folder = 'drivers/licenses';
  } else if (fieldName === 'cityImage') {
    folder = 'cities/images';
  } else if (fieldName === 'categoryImage') {
    folder = 'categories/images';
  } else if (fieldName === 'carimage') {
    folder = 'bookings/car-images';
  } else if (fieldName === 'airportImage') {
    folder = 'airports/images';
  } else if (fieldName === 'brandIcon') {
    folder = 'brands/icons';
  }
  
  return `${folder}/${timestamp}-${randomString}${extension}`;
};

// Configure multer for S3 upload with 50MB limit
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
        fileType: file.fieldname === 'specialRequestAudio' ? 'audio' : 'image',
        uploadTime: new Date().toISOString()
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
    fileSize: 50 * 1024 * 1024 // 50MB limit for all files (images and audio)
  }
});

// Function to delete file from S3
const deleteFromS3 = async (key) => {
  if (!key) {
    console.log('No key provided for deletion');
    return false;
  }
  
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
    return false;
  }
};

// Generate public URL for S3 object
const getS3Url = (key) => {
  if (!key) return null;
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION || 'ap-southeast-2'}.amazonaws.com/${key}`;
};

// Helper function to extract key from URL
const extractKeyFromUrl = (url) => {
  if (!url) return null;
  try {
    // Method 1: Parse URL object
    try {
      const urlObj = new URL(url);
      // Remove leading slash if present
      return urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
    } catch (urlError) {
      // Method 2: Simple string split as fallback
      const parts = url.split('.amazonaws.com/');
      return parts.length > 1 ? parts[1] : null;
    }
  } catch (error) {
    console.error('Error extracting key from URL:', error);
    return null;
  }
};

// Helper function to format file object for database storage
const formatFile = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date()
  };
};

// Helper function to format user profile image
const formatUserProfileImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format terminal image
const formatTerminalImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format banner English image
const formatBannerImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format banner Arabic image
const formatBannerImageAr = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format model/collection icon
const formatModelIcon = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format hourly booking car image
const formatHourlyCarImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format hourly booking audio file
const formatHourlyAudioFile = (file) => {
  if (!file) return null;
  
  const extension = file.originalname.split('.').pop().toLowerCase();
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    duration: null,
    format: extension
  };
};

// Helper function to format driver license image
const formatLicenseImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format city image
const formatCityImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format category image
const formatCategoryImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format regular booking car image
const formatCarImage = (file) => {
  if (!file) return null;
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size
  };
};

// Helper function to format regular booking audio file
const formatAudioFile = (file) => {
  if (!file) return null;
  
  const extension = file.originalname.split('.').pop().toLowerCase();
  
  return {
    key: file.key,
    url: getS3Url(file.key),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    duration: null,
    format: extension
  };
};

console.log('S3 Config loaded successfully');

module.exports = {
  s3Client,
  upload,
  deleteFromS3,
  getS3Url,
  extractKeyFromUrl,
  formatFile,
  formatUserProfileImage,
  formatTerminalImage,
  formatBannerImage,
  formatBannerImageAr,
  formatModelIcon,
  formatHourlyCarImage,
  formatHourlyAudioFile,
  formatLicenseImage,
  formatCityImage,
  formatCategoryImage,
  formatCarImage,
  formatAudioFile
};
