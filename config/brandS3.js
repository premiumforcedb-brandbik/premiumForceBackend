// config/s3config.js
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const crypto = require('crypto');

// Debug: Check if environment variables are loaded
console.log('Loading S3 Config for Brands...');
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('AWS_S3_BUCKET_NAME:', process.env.AWS_S3_BUCKET_NAME);
console.log('AWS_ACCESS_KEY_ID exists:', !!process.env.AWS_ACCESS_KEY_ID);

// Validate required environment variables
if (!process.env.AWS_S3_BUCKET_NAME) {
  console.error('ERROR: AWS_S3_BUCKET_NAME is not defined in environment variables');
  // Don't exit, just log for development
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('ERROR: AWS credentials are not defined in environment variables');
}

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Allowed image types for brands
const allowedBrandImageTypes = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'svg'];

// File filter specifically for brand icon
const brandFileFilter = (req, file, cb) => {
  const fieldName = file.fieldname;
  const extname = path.extname(file.originalname).toLowerCase().substring(1);
  const mimetype = file.mimetype;
  
  console.log('Brand file filter check:', { fieldName, extname, mimetype });
  
  // Only accept brandIcon field
  if (fieldName === 'brandIcon') {
    const isImage = allowedBrandImageTypes.includes(extname) && 
                   (mimetype.startsWith('image/') || allowedBrandImageTypes.includes(extname));
    
    if (isImage) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for brand icon (jpeg, jpg, png, gif, webp, svg)'), false);
    }
  } else {
    cb(new Error(`Unexpected field: ${fieldName}. Expected 'brandIcon'`), false);
  }
};

// Generate unique filename for brand icon
const generateBrandFileName = (originalname) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(16).toString('hex');
  const extension = path.extname(originalname);
  return `brands/icons/${timestamp}-${randomString}${extension}`;
};

// Configure multer for brand S3 upload
console.log('Creating multer S3 storage for brands with bucket:', process.env.AWS_S3_BUCKET_NAME);

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, { 
        fieldName: file.fieldname,
        originalName: file.originalname,
        contentType: file.mimetype,
        uploadType: 'brand_icon',
        uploadTime: new Date().toISOString()
      });
    },
    key: (req, file, cb) => {
      const fileName = generateBrandFileName(file.originalname);
      console.log('Generated S3 key for brand icon:', fileName);
      cb(null, fileName);
    }
  }),
  fileFilter: brandFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for brand icons
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

// Format file object for response
const formatBrandFile = (file) => {
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

// Error handler for multer
const handleBrandUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'FILE_TOO_LARGE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.',
        messageAr: 'الملف كبير جدًا. الحد الأقصى 5 ميجابايت'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message,
      messageAr: 'خطأ في رفع الملف'
    });
  }
  next(err);
};

console.log('S3 Config for Brands loaded successfully');

module.exports = {
  s3Client,
  upload,
  deleteFromS3,
  getS3Url,
  formatBrandFile,
  handleBrandUploadError
};