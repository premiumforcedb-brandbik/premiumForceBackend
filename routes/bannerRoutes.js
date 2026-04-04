const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Banner = require('../models/banner_model');
const { upload, deleteFromS3, getS3Url } = require('../config/s3config');

const {   authenticateToken,
  authorizeAdmin,
  authorizeRoles,
  authorizeAny,
 } = require('../middleware/adminmiddleware');

// ============= HELPER FUNCTIONS =============
const formatFileData = (file) => ({
  key: file.key,
  url: getS3Url(file.key),
  originalName: file.originalname,
  mimeType: file.mimetype,
  size: file.size
});

const cleanupUploadedFiles = async (files) => {
  if (!files) return;
  
  const deletePromises = [];
  
  if (files.image) {
    deletePromises.push(
      deleteFromS3(files.image[0].key).catch(err => 
        console.error('Error deleting banner image:', err)
      )
    );
  }
  
  await Promise.all(deletePromises);
};


// ============= CREATE BANNER =============
// POST /api/banners - Create a new banner (image and imageAr mandatory)
router.post('/', 
  authenticateToken, 
  authorizeAdmin,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'imageAr', maxCount: 1 }]), 
  async (req, res) => {
    try {
      const { 
        name, 
        isActive = true,
        description,
        link,
        priority = 0,
        startDate,
        endDate
      } = req.body;

      console.log('Create banner - Body:', req.body);
      console.log('Create banner - Files:', req.files);

      // Validate required fields
      if (!name) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Please provide name'
        });
      }

      // Validate image is mandatory
      if (!req.files || !req.files.image || !req.files.image[0]) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'English image (image) is required',
          field: 'image'
        });
      }

      // Validate imageAr is mandatory
      if (!req.files || !req.files.imageAr || !req.files.imageAr[0]) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Arabic image (imageAr) is required',
          field: 'imageAr'
        });
      }

      // CHECK IF BANNER NAME ALREADY EXISTS (Case insensitive)
      const existingBannerByName = await Banner.findOne({ 
        name: { $regex: new RegExp(`^${name}$`, 'i') }
      });
      
      if (existingBannerByName) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Banner with this name already exists',
          field: 'name'
        });
      }

      // Prepare banner data
      const bannerData = {
        name,
        isActive: isActive === 'true' || isActive === true,
        description: description || undefined,
        link: link || undefined,
        priority: parseInt(priority) || 0,
        createdBy: req.user.userId,
        image: null,
        imageAr: null
      };

      // Add dates if provided
      if (startDate) {
        bannerData.startDate = new Date(startDate);
      }
      
      if (endDate) {
        bannerData.endDate = new Date(endDate);
      }

      // Add English image (mandatory)
      if (req.files && req.files.image && req.files.image[0]) {
        console.log('English image uploaded:', req.files.image[0]);
        bannerData.image = formatFileData(req.files.image[0]);
        console.log('Formatted English image data:', bannerData.image);
      }

      // Add Arabic image (mandatory)
      if (req.files && req.files.imageAr && req.files.imageAr[0]) {
        console.log('Arabic image uploaded:', req.files.imageAr[0]);
        bannerData.imageAr = formatFileData(req.files.imageAr[0]);
        console.log('Formatted Arabic image data:', bannerData.imageAr);
      }

      // Create new banner
      const newBanner = new Banner(bannerData);
      const savedBanner = await newBanner.save();

      res.status(201).json({
        success: true,
        message: 'Banner created successfully with both English and Arabic images',
        data: savedBanner.getPublicBanner()
      });

    } catch (error) {
      // Delete uploaded files if error occurs
      await cleanupUploadedFiles(req.files);

      console.error('Create banner error:', error);

      // Handle duplicate key error
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return res.status(400).json({
          success: false,
          message: `Banner with this ${field} already exists`,
          field: field
        });
      }

      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error creating banner',
        error: error.message
      });
    }
  }
);

// ============= UPDATE BANNER =============
// PUT /api/banners/:id - Update banner
router.put('/:id', 
  authenticateToken, 
  authorizeAdmin,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'imageAr', maxCount: 1 }]), 
  async (req, res) => {
    try {
      const { id } = req.params;
      const { 
        name, 
        isActive,
        description,
        link,
        priority,
        startDate,
        endDate
      } = req.body;

      console.log('Update banner - ID:', id);
      console.log('Update banner - Body:', req.body);
      console.log('Update banner - Files:', req.files);

      // Validate ID
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Invalid banner ID format'
        });
      }

      // FIND BY ID
      const banner = await Banner.findById(id);
      
      if (!banner) {
        await cleanupUploadedFiles(req.files);
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }

      // CHECK IF BANNER NAME ALREADY EXISTS (if name is being changed)
      if (name && name.toLowerCase() !== banner.name.toLowerCase()) {
        const existingBannerByName = await Banner.findOne({ 
          name: { $regex: new RegExp(`^${name}$`, 'i') },
          _id: { $ne: id }
        });
        
        if (existingBannerByName) {
          await cleanupUploadedFiles(req.files);
          return res.status(400).json({
            success: false,
            message: 'Banner with this name already exists',
            field: 'name'
          });
        }
      }

      // Prepare update data
      const updateData = {
        updatedBy: req.user.userId
      };

      // Add fields to update if provided
      if (name) updateData.name = name;
      if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;
      if (description !== undefined) updateData.description = description || undefined;
      if (link !== undefined) updateData.link = link || undefined;
      if (priority !== undefined) updateData.priority = parseInt(priority);
      if (startDate) updateData.startDate = new Date(startDate);
      if (endDate) updateData.endDate = new Date(endDate);
      
      // Handle English image upload (mandatory check)
      if (req.files && req.files.image && req.files.image[0]) {
        console.log('New English image uploaded:', req.files.image[0]);
        
        // Delete old English image from S3 if exists
        if (banner.image && banner.image.key) {
          console.log('Deleting old English image:', banner.image.key);
          await deleteFromS3(banner.image.key).catch(err => 
            console.error('Error deleting old English image:', err)
          );
        }
        
        // Add new English image data
        updateData.image = formatFileData(req.files.image[0]);
        console.log('New English image data:', updateData.image);
      } else if (req.body.requireImage === 'true' && !banner.image) {
        // If image is required but not provided and no existing image
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'English image (image) is required',
          field: 'image'
        });
      }
      
      // Handle Arabic image upload (mandatory check)
      if (req.files && req.files.imageAr && req.files.imageAr[0]) {
        console.log('New Arabic image uploaded:', req.files.imageAr[0]);
        
        // Delete old Arabic image from S3 if exists
        if (banner.imageAr && banner.imageAr.key) {
          console.log('Deleting old Arabic image:', banner.imageAr.key);
          await deleteFromS3(banner.imageAr.key).catch(err => 
            console.error('Error deleting old Arabic image:', err)
          );
        }
        
        // Add new Arabic image data
        updateData.imageAr = formatFileData(req.files.imageAr[0]);
        console.log('New Arabic image data:', updateData.imageAr);
      } else if (req.body.requireImageAr === 'true' && !banner.imageAr) {
        // If imageAr is required but not provided and no existing image
        await cleanupUploadedFiles(req.files);
        return res.status(400).json({
          success: false,
          message: 'Arabic image (imageAr) is required',
          field: 'imageAr'
        });
      }

      console.log('Update data:', updateData);

      // Update banner
      const updatedBanner = await Banner.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!updatedBanner) {
        return res.status(404).json({
          success: false,
          message: 'Banner not found after update'
        });
      }

      let successMessage = 'Banner updated successfully';
      if (updateData.image && updateData.imageAr) {
        successMessage = 'Banner updated successfully with both English and Arabic images';
      } else if (updateData.image) {
        successMessage = 'Banner updated successfully with English image only';
      } else if (updateData.imageAr) {
        successMessage = 'Banner updated successfully with Arabic image only';
      }

      res.status(200).json({
        success: true,
        message: successMessage,
        data: updatedBanner.getPublicBanner()
      });

    } catch (error) {
      // Delete newly uploaded files if error occurs
      await cleanupUploadedFiles(req.files);

      console.error('Update banner error:', error);

      // Handle duplicate key error
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return res.status(400).json({
          success: false,
          message: `Banner with this ${field} already exists`,
          field: field
        });
      }

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid banner ID format'
        });
      }

      if (error.name === 'ValidationError') {
        const errors = {};
        for (let field in error.errors) {
          errors[field] = error.errors[field].message;
        }
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors
        });
      }

      res.status(500).json({
        success: false,
        message: 'Error updating banner',
        error: error.message
      });
    }
  }
);




// ============= GET ALL BANNERS =============
// GET /api/banners - Get all banners with filtering
router.get('/', async (req, res) => {
  try {
    const { 
      isActive, 
      search,
      sort = '-priority',
      page = 1, 
      limit = 10 
    } = req.query;

    // Build query - removed categoryName
    const query = {};
    
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Add date filter for active banners
    if (isActive === 'true') {
      query.$and = [
        { $or: [{ startDate: { $lte: new Date() } }, { startDate: { $exists: false } }] },
        { $or: [{ endDate: { $gte: new Date() } }, { endDate: { $exists: false } }] }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const banners = await Banner.find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username');
    
    const total = await Banner.countDocuments(query);

    res.status(200).json({
      success: true,
      count: banners.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      data: banners.map(banner => banner.getPublicBanner())
    });

  } catch (error) {
    console.error('Fetch banners error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching banners',
      error: error.message
    });
  }
});

// ============= GET ACTIVE BANNERS (Public) =============
// GET /api/banners/active - Get all active banners for display
router.get('/active',  authenticateToken, 
  authorizeAdmin, async (req, res) => {
  try {
    const { limit = 20 } = req.query; // removed categoryName

    const query = { 
      isActive: true,
      $and: [
        { $or: [{ startDate: { $lte: new Date() } }, { startDate: { $exists: false } }] },
        { $or: [{ endDate: { $gte: new Date() } }, { endDate: { $exists: false } }] }
      ]
    };

    const banners = await Banner.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: banners.length,
      data: banners.map(banner => banner.getPublicBanner())
    });

  } catch (error) {
    console.error('Fetch active banners error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active banners',
      error: error.message
    });
  }
});


// ============= GET BANNER BY ID =============
// GET /api/banners/:id - Get single banner
router.get('/:id',  authenticateToken, 
  authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid banner ID format'
      });
    }

    const banner = await Banner.findById(id)
      .populate('createdBy', 'username')
      .populate('updatedBy', 'username');

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    // Increment view count
    banner.viewCount += 1;
    await banner.save();

    res.status(200).json({
      success: true,
      data: banner.getPublicBanner()
    });

  } catch (error) {
    console.error('Fetch banner error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching banner',
      error: error.message
    });
  }
});

// ============= UPDATE BANNER STATUS =============
// PATCH /api/banners/:id/status - Update only banner status
router.patch('/:id/status', 
  authenticateToken, 
  authorizeAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid banner ID format'
        });
      }

      if (isActive === undefined) {
        return res.status(400).json({
          success: false,
          message: 'isActive field is required'
        });
      }

      const banner = await Banner.findByIdAndUpdate(
        id,
        {
          isActive: isActive === 'true' || isActive === true,
          updatedBy: req.user.userId
        },
        { new: true }
      );

      if (!banner) {
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }

      res.status(200).json({
        success: true,
        message: `Banner ${banner.isActive ? 'activated' : 'deactivated'} successfully`,
        data: {
          id: banner._id,
          name: banner.name,
          isActive: banner.isActive
        }
      });

    } catch (error) {
      console.error('Update banner status error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating banner status',
        error: error.message
      });
    }
  }
);

// ============= UPDATE BANNER IMAGE =============
// PATCH /api/banners/:id/image - Update only banner image
router.patch('/:id/image', 
  authenticateToken, 
  authorizeAdmin,
  upload.single('image'), 
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Image file is required'
        });
      }

      if (!mongoose.Types.ObjectId.isValid(id)) {
        await deleteFromS3(req.file.key);
        return res.status(400).json({
          success: false,
          message: 'Invalid banner ID format'
        });
      }

      const banner = await Banner.findById(id);
      
      if (!banner) {
        await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }

      // Delete old image
      if (banner.image && banner.image.key) {
        await deleteFromS3(banner.image.key).catch(err => 
          console.error('Error deleting old image:', err)
        );
      }

      // Update with new image
      banner.image = formatFileData(req.file);
      banner.updatedBy = req.user.userId;
      await banner.save();

      res.status(200).json({
        success: true,
        message: 'Banner image updated successfully',
        data: {
          image: banner.image
        }
      });

    } catch (error) {
      if (req.file) {
        await deleteFromS3(req.file.key).catch(console.error);
      }
      
      console.error('Update banner image error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating banner image',
        error: error.message
      });
    }
  }
);

// ============= DELETE BANNER =============
// DELETE /api/banners/:id - Delete banner
router.delete('/:id', 
  authenticateToken, 
  authorizeAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid banner ID format'
        });
      }

      const banner = await Banner.findById(id);
      
      if (!banner) {
        return res.status(404).json({
          success: false,
          message: 'Banner not found'
        });
      }

      // Delete image from S3
      if (banner.image && banner.image.key) {
        await deleteFromS3(banner.image.key).catch(err => 
          console.error('Error deleting banner image:', err)
        );
      }

      // Delete banner
      await Banner.findByIdAndDelete(id);

      res.status(200).json({
        success: true,
        message: 'Banner deleted successfully'
      });

    } catch (error) {
      console.error('Delete banner error:', error);
      res.status(500).json({
        success: false,
        message: 'Error deleting banner',
        error: error.message
      });
    }
  }
);

// ============= TRACK BANNER CLICK =============
// POST /api/banners/:id/click - Track banner click
router.post('/:id/click',  
  authenticateToken, 
  authorizeAdmin,
   async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid banner ID format'
      });
    }

    const banner = await Banner.findByIdAndUpdate(
      id,
      { $inc: { clickCount: 1 } },
      { new: true }
    );

    if (!banner) {
      return res.status(404).json({
        success: false,
        message: 'Banner not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Click tracked successfully',
      data: {
        clickCount: banner.clickCount
      }
    });

  } catch (error) {
    console.error('Track click error:', error);
    res.status(500).json({
      success: false,
      message: 'Error tracking click',
      error: error.message
    });
  }
});

// ============= BULK UPDATE BANNERS =============
// PATCH /api/banners/bulk/status - Bulk update banner status
router.patch('/bulk/status', 
  authenticateToken, 
  authorizeAdmin,
  async (req, res) => {
    try {
      const { bannerIds, isActive } = req.body;

      if (!bannerIds || !Array.isArray(bannerIds) || bannerIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please provide an array of banner IDs'
        });
      }

      if (isActive === undefined) {
        return res.status(400).json({
          success: false,
          message: 'isActive field is required'
        });
      }

      const result = await Banner.updateMany(
        { _id: { $in: bannerIds } },
        {
          isActive: isActive === 'true' || isActive === true,
          updatedBy: req.user.userId
        }
      );

      res.status(200).json({
        success: true,
        message: `${result.modifiedCount} banners updated successfully`,
        data: {
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount
        }
      });

    } catch (error) {
      console.error('Bulk update error:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating banners',
        error: error.message
      });
    }
  }
);

module.exports = router;

