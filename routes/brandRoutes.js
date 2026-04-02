const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Brand = require('../models/brandModel');
const Category = require('../models/categoryModel');
// const { upload, deleteFromS3, getS3Url } = require('../config/s3config');
const { authenticateToken, authorizeAdmin } = require('../middleware/adminmiddleware');

const { upload, deleteFromS3, formatBrandFile, handleBrandUploadError } = require('../config/brandS3');

// Helper: Format file data
const formatFile = (file) => ({
  key: file.key,
  url: getS3Url(file.key),
  originalName: file.originalname,
  mimeType: file.mimetype,
  size: file.size
});



// // ============= CREATE BRAND =============
// // POST /api/brands
// router.post('/',  upload.single('brandIcon'), async (req, res) => {
//   try {
//     const { brandName, isActive = true } = req.body;

//     console.log('Create brand - body:', req.body);
//     console.log('Create brand - file:', req.file);

//     // Validate required fields
//     if (!brandName) {
//       if (req.file) await deleteFromS3(req.file.key);
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Brand name is required' 
//       });
//     }

//     // Check for duplicate brand name (case insensitive)
//     const existingBrand = await Brand.findOne({ 
//       brandName: { $regex: new RegExp(`^${brandName.trim()}$`, 'i') } 
//     });

//     if (existingBrand) {
//       if (req.file) await deleteFromS3(req.file.key);
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Brand with this name already exists' 
//       });
//     }

//     // Prepare brand data
//     const brandData = {
//       brandName: brandName.trim(),
//       isActive: isActive === 'true' || isActive === true,
//       brandIcon: req.file ? formatFile(req.file) : null
//     };

//     const brand = await Brand.create(brandData);

//     res.status(201).json({
//       success: true,
//       message: brandData.brandIcon ? 'Brand created with icon' : 'Brand created without icon',
//       data: brand
//     });

//   } catch (error) {
//     if (req.file) await deleteFromS3(req.file.key);
//     console.error('Create brand error:', error);
    
//     if (error.code === 11000) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Brand name already exists' 
//       });
//     }
    
//     res.status(500).json({ 
//       success: false, 
//       message: error.message 
//     });
//   }
// });



// ============= CREATE BRAND =============
router.post('/', 
  authenticateToken,
  authorizeAdmin,
  (req, res, next) => {
    upload.single('brandIcon')(req, res, (err) => {
      if (err) {
        return handleBrandUploadError(err, req, res, next);
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const { brandName, brandNameAr, isActive = true, categories } = req.body;

      console.log('Create brand - body:', req.body);
      console.log('Create brand - file:', req.file);

      // Validate required fields
      if (!brandName || !brandName.trim()) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ 
          success: false, 
          message: 'Brand name is required',
          messageAr: 'اسم العلامة التجارية مطلوب'
        });
      }

      // Check if brand icon is uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Brand icon is required',
          messageAr: 'أيقونة العلامة التجارية مطلوبة'
        });
      }

      // Check for duplicate brand name
      const existingBrand = await Brand.findOne({ 
        brandName: { $regex: new RegExp(`^${brandName.trim()}$`, 'i') } 
      });

      if (existingBrand) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(400).json({ 
          success: false, 
          message: 'Brand with this name already exists',
          messageAr: 'العلامة التجارية بهذا الاسم موجودة بالفعل'
        });
      }

      // Process categories if provided
      let categoryIds = [];
      if (categories) {
        const categoryArray = Array.isArray(categories) ? categories : [categories];
        
        // Validate category IDs
        const validCategories = categoryArray.filter(id => mongoose.Types.ObjectId.isValid(id));
        
        if (validCategories.length !== categoryArray.length) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({
            success: false,
            message: 'Invalid category IDs provided',
            messageAr: 'معرفات الفئات غير صالحة'
          });
        }
        
        // Check if categories exist
        const existingCategories = await Category.find({
          _id: { $in: validCategories }
        });
        
        if (existingCategories.length !== validCategories.length) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({
            success: false,
            message: 'One or more categories not found',
            messageAr: 'واحدة أو أكثر من الفئات غير موجودة'
          });
        }
        
        categoryIds = existingCategories.map(c => c._id);
      }

      // Create brand
      const brand = new Brand({
        brandName: brandName.trim(),
        brandNameAr: brandNameAr ? brandNameAr.trim() : brandName.trim(),
        brandIcon: formatBrandFile(req.file),
        isActive: isActive === 'true' || isActive === true,
        categories: categoryIds
      });

      await brand.save();

      // Get complete brand with populated categories
      const completeBrand = await Brand.findById(brand._id)
        .populate({
          path: 'categories',
          select: 'name nameAr image isActive description'
        });

      res.status(201).json({
        success: true,
        message: 'Brand created successfully',
        messageAr: 'تم إنشاء العلامة التجارية بنجاح',
        data: completeBrand
      });

    } catch (error) {
      if (req.file) await deleteFromS3(req.file.key);
      console.error('Create brand error:', error);
      
      if (error.code === 11000) {
        return res.status(400).json({ 
          success: false, 
          message: 'Brand name already exists',
          messageAr: 'اسم العلامة التجارية موجود بالفعل'
        });
      }
      
      res.status(500).json({ 
        success: false, 
        message: error.message,
        messageAr: 'خطأ في إنشاء العلامة التجارية'
      });
    }
});


// ============= UPDATE BRAND =============
router.put('/:id', 
  authenticateToken,
  authorizeAdmin,
  (req, res, next) => {
    upload.single('brandIcon')(req, res, (err) => {
      if (err) {
        return handleBrandUploadError(err, req, res, next);
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const { id } = req.params;
      const { brandName, brandNameAr, isActive, categories } = req.body;

      console.log('Update brand - ID:', id);
      console.log('Update brand - body:', req.body);
      console.log('Update brand - file:', req.file);

      // Find existing brand
      const existingBrand = await Brand.findById(id);
      if (!existingBrand) {
        if (req.file) await deleteFromS3(req.file.key);
        return res.status(404).json({
          success: false,
          message: 'Brand not found',
          messageAr: 'العلامة التجارية غير موجودة'
        });
      }

      // Check for duplicate brand name
      if (brandName && brandName.trim() !== existingBrand.brandName) {
        const duplicateBrand = await Brand.findOne({
          brandName: { $regex: new RegExp(`^${brandName.trim()}$`, 'i') },
          _id: { $ne: id }
        });

        if (duplicateBrand) {
          if (req.file) await deleteFromS3(req.file.key);
          return res.status(400).json({
            success: false,
            message: 'Brand with this name already exists',
            messageAr: 'العلامة التجارية بهذا الاسم موجودة بالفعل'
          });
        }
      }

      // Handle brand icon update
      let brandIconData = existingBrand.brandIcon;
      if (req.file) {
        // Delete old icon from S3
        if (existingBrand.brandIcon?.key) {
          await deleteFromS3(existingBrand.brandIcon.key);
        }
        brandIconData = formatBrandFile(req.file);
      }

      // Process categories if provided
      let categoryIds = existingBrand.categories;
      if (categories !== undefined) {
        const categoryArray = Array.isArray(categories) ? categories : 
                             (categories ? [categories] : []);
        
        if (categoryArray.length > 0) {
          const validCategories = categoryArray.filter(id => mongoose.Types.ObjectId.isValid(id));
          
          if (validCategories.length !== categoryArray.length) {
            if (req.file) await deleteFromS3(req.file.key);
            return res.status(400).json({
              success: false,
              message: 'Invalid category IDs provided',
              messageAr: 'معرفات الفئات غير صالحة'
            });
          }
          
          const existingCategories = await Category.find({
            _id: { $in: validCategories }
          });
          
          categoryIds = existingCategories.map(c => c._id);
        } else {
          categoryIds = [];
        }
      }

      // Update brand
      const updatedBrand = await Brand.findByIdAndUpdate(
        id,
        {
          brandName: brandName ? brandName.trim() : existingBrand.brandName,
          brandNameAr: brandNameAr ? brandNameAr.trim() : (brandName ? brandName.trim() : existingBrand.brandNameAr),
          brandIcon: brandIconData,
          isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : existingBrand.isActive,
          categories: categoryIds
        },
        { new: true, runValidators: true }
      ).populate({
        path: 'categories',
        select: 'name nameAr image isActive description'
      });

      res.status(200).json({
        success: true,
        message: 'Brand updated successfully',
        messageAr: 'تم تحديث العلامة التجارية بنجاح',
        data: updatedBrand
      });

    } catch (error) {
      if (req.file) await deleteFromS3(req.file.key);
      console.error('Update brand error:', error);
      
      res.status(500).json({ 
        success: false, 
        message: error.message,
        messageAr: 'خطأ في تحديث العلامة التجارية'
      });
    }
});





// // ============= UPDATE BRAND =============
// // PUT /api/brands/:id
// router.put('/:id', authenticateToken, authorizeAdmin, upload.single('brandIcon'), async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { brandName, isActive } = req.body;

//     console.log('Update brand - id:', id);
//     console.log('Update brand - body:', req.body);
//     console.log('Update brand - file:', req.file);

//     // Validate ID
//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       if (req.file) await deleteFromS3(req.file.key);
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Invalid brand ID format' 
//       });
//     }

//     // Find existing brand
//     const brand = await Brand.findById(id);
//     if (!brand) {
//       if (req.file) await deleteFromS3(req.file.key);
//       return res.status(404).json({ 
//         success: false, 
//         message: 'Brand not found' 
//       });
//     }

//     // Check for duplicate name if name is being changed
//     if (brandName && brandName.trim().toLowerCase() !== brand.brandName.toLowerCase()) {
//       const existingBrand = await Brand.findOne({ 
//         brandName: { $regex: new RegExp(`^${brandName.trim()}$`, 'i') },
//         _id: { $ne: id }
//       });

//       if (existingBrand) {
//         if (req.file) await deleteFromS3(req.file.key);
//         return res.status(400).json({ 
//           success: false, 
//           message: 'Brand name already exists' 
//         });
//       }
//     }

//     // Prepare update data
//     const updateData = {};
//     if (brandName) updateData.brandName = brandName.trim();
//     if (isActive !== undefined) {
//       updateData.isActive = isActive === 'true' || isActive === true;
//     }

//     // Handle icon update
//     if (req.file) {
//       // Delete old icon
//       if (brand.brandIcon?.key) {
//         await deleteFromS3(brand.brandIcon.key).catch(() => {});
//       }
//       updateData.brandIcon = formatFile(req.file);
//     }

//     // Update brand
//     const updatedBrand = await Brand.findByIdAndUpdate(
//       id, 
//       updateData, 
//       { new: true, runValidators: true }
//     );

//     res.json({
//       success: true,
//       message: req.file ? 'Brand updated with new icon' : 'Brand updated',
//       data: updatedBrand
//     });

//   } catch (error) {
//     if (req.file) await deleteFromS3(req.file.key);
//     console.error('Update brand error:', error);
    
//     if (error.code === 11000) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Brand name already exists' 
//       });
//     }
    
//     res.status(500).json({ 
//       success: false, 
//       message: error.message 
//     });
//   }
// });




// GET /api/brands - Get all brands with optional filters
router.get('/', async (req, res) => {
  try {
    const { isActive, categoryId, search, page = 1, limit = 10 } = req.query;
    
    console.log('Get all brands - query:', req.query);

    // Build filter query
    let filterQuery = {};
    
    // Filter by active status
    if (isActive !== undefined) {
      filterQuery.isActive = isActive === 'true';
    }
    
    // Filter by category
    if (categoryId) {
      filterQuery.categories = categoryId;
    }
    
    // Search by brand name
    if (search) {
      filterQuery.brandName = { $regex: search, $options: 'i' };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitValue = parseInt(limit);

    // Get total count for pagination
    const totalBrands = await Brand.countDocuments(filterQuery);

    // Get brands with populated categories
    const brands = await Brand.find(filterQuery)
      .populate({
        path: 'categories',
        match: isActive === 'true' ? { isActive: true } : {},
        select: 'name image isActive priority description createdAt updatedAt',
        options: { sort: { priority: -1, name: 1 } }
      })
      .sort({ brandName: 1 })
      .skip(skip)
      .limit(limitValue);

    // Format response data
    const formattedBrands = brands.map(brand => ({
      _id: brand._id,
      brandName: brand.brandName,
      brandIcon: brand.brandIcon,
      isActive: brand.isActive,
      categories: brand.categories.map(cat => ({
        _id: cat._id,
        name: cat.name,
        image: cat.image,
        isActive: cat.isActive,
        description: cat.description,
        priority: cat.priority,
        createdAt: cat.createdAt,
        updatedAt: cat.updatedAt
      })),
      createdAt: brand.createdAt,
      updatedAt: brand.updatedAt
    }));

    // Calculate summary statistics
    const summary = {
      totalBrands,
      activeBrands: await Brand.countDocuments({ isActive: true }),
      inactiveBrands: await Brand.countDocuments({ isActive: false }),
      totalCategories: formattedBrands.reduce((sum, brand) => sum + brand.categories.length, 0),
      brandsWithCategories: formattedBrands.filter(b => b.categories.length > 0).length
    };

    res.status(200).json({
      success: true,
      message: 'Brands fetched successfully',
      data: {
        brands: formattedBrands,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalBrands / limitValue),
          totalItems: totalBrands,
          itemsPerPage: limitValue,
          hasNextPage: skip + limitValue < totalBrands,
          hasPrevPage: page > 1
        },
        summary: summary,
        filters: {
          isActive: isActive || 'all',
          categoryId: categoryId || 'all',
          search: search || 'none'
        }
      }
    });

  } catch (error) {
    console.error('Get all brands error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching brands',
      error: error.message
    });
  }
});



// ============= GET BRAND BY ID WITH BASIC CATEGORY LIST =============
// GET /api/brands/:id - Get single brand with basic category list
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    console.log('Get brand by ID:', id);

    // Find brand by ID and populate categories with basic fields
    const brand = await Brand.findById(id)
      .populate({
        path: 'categories',
        select: 'name image isActive priority description',
        options: { sort: { priority: -1, name: 1 } }
      });

    if (!brand) {
      return res.status(404).json({
        success: false,
        message: 'Brand not found'
      });
    }

    // Format the response with category list
    const responseData = {
      brandInfo: {
        _id: brand._id,
        name: brand.brandName,
        icon: brand.brandIcon,
        isActive: brand.isActive,
        createdAt: brand.createdAt,
        updatedAt: brand.updatedAt
      },
      // Category list (simplified)
      categories: brand.categories.map(cat => ({
        id: cat._id,
        name: cat.name,
        image: cat.image?.url || null,
        isActive: cat.isActive,
        priority: cat.priority
      })),
      // Quick stats
      stats: {
        totalCategories: brand.categories.length,
        activeCategories: brand.categories.filter(c => c.isActive).length
      }
    };

    res.status(200).json({
      success: true,
      message: 'Brand fetched successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Get brand by ID error:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid brand ID format'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error fetching brand',
      error: error.message
    });
  }
});




// ============= GET ALL BRANDS =============
// GET /api/brands?page=1&limit=10&isActive=true&search=bmw
router.get('/s', async (req, res) => {
  try {
    const { 
      isActive, 
      search, 
      page = 1, 
      limit = 10 
    } = req.query;

    // Build query
    const query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) query.brandName = { $regex: search, $options: 'i' };

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [brands, total] = await Promise.all([
      Brand.find(query)
        .sort({ brandName: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Brand.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: brands,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Get brands error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= GET ACTIVE BRANDS =============
// GET /api/brands/active
router.get('/active',authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const brands = await Brand.find({ isActive: true })
      .sort({ brandName: 1 });

    res.json({
      success: true,
      count: brands.length,
      data: brands
    });

  } catch (error) {
    console.error('Get active brands error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= GET BRAND BY ID =============
// GET /api/brands/:id
router.get('/s/:id',authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid brand ID format' 
      });
    }

    const brand = await Brand.findById(id);
    
    if (!brand) {
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    res.json({ success: true, data: brand });

  } catch (error) {
    console.error('Get brand error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});


// ============= TOGGLE BRAND STATUS =============
// PATCH /api/brands/:id/toggle
router.patch('/:id/toggle', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid brand ID format' 
      });
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    brand.isActive = !brand.isActive;
    await brand.save();

    res.json({
      success: true,
      message: `Brand ${brand.isActive ? 'activated' : 'deactivated'}`,
      data: { isActive: brand.isActive }
    });

  } catch (error) {
    console.error('Toggle brand error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============= DELETE BRAND =============
// DELETE /api/brands/:id
router.delete('/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid brand ID format' 
      });
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      return res.status(404).json({ 
        success: false, 
        message: 'Brand not found' 
      });
    }

    // Delete icon from S3
    if (brand.brandIcon?.key) {
      await deleteFromS3(brand.brandIcon.key).catch(() => {});
    }

    await Brand.findByIdAndDelete(id);

    res.json({ 
      success: true, 
      message: 'Brand deleted successfully' 
    });

  } catch (error) {
    console.error('Delete brand error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

module.exports = router;