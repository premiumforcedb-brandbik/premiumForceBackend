const express = require('express');
const Admin = require('../models/adminModel');
// const User = require('../models/users_model');
const jwt = require('jsonwebtoken');

const router = express.Router();


// Authentication middleware that works for BOTH users and admins
const authenticateAny = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

        console.log('Decoded token keys:', Object.keys(decoded));

        // Check for admin token (has adminId)
        if (decoded.adminId) {
            const admin = await Admin.findById(decoded.adminId).select('-password');
            if (!admin) {
                return res.status(401).json({ success: false, message: 'Admin not found' });
            }
            req.account = admin;
            req.accountType = 'admin';
            console.log(`✅ Authenticated as ADMIN: ${admin.email}`);
        }
        // Check for user token (has userId or _id)
        else if (decoded.userId || decoded._id) {
            const userId = decoded.userId || decoded._id;
            const user = await User.findById(userId).select('-password');
            if (!user) {
                return res.status(401).json({ success: false, message: 'User not found' });
            }
            req.account = user;
            req.accountType = 'user';
            console.log(`✅ Authenticated as USER: ${user.email}`);
        }
        else {
            return res.status(401).json({ success: false, message: 'Invalid token format' });
        }

        next();
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

// UNIVERSAL FCM TOKEN ROUTE - Works for both users and admins
router.post('/fcm-token', authenticateAny, async (req, res) => {
    try {
        const { fcmToken } = req.body;

        if (!fcmToken || typeof fcmToken !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'fcmToken is required and must be a string.'
            });
        }

        let updatedAccount;

        if (req.accountType === 'admin') {
            updatedAccount = await Admin.findByIdAndUpdate(
                req.account._id,
                { fcmToken },
                { new: true, select: '_id email fcmToken role' }
            );
            console.log(`🔔 Admin FCM token saved: ${updatedAccount.email}`);
        } else {
            updatedAccount = await User.findByIdAndUpdate(
                req.account._id,
                { fcmToken },
                { new: true, select: '_id email fcmToken' }
            );
            console.log(`🔔 User FCM token saved: ${updatedAccount.email}`);
        }

        if (!updatedAccount) {
            return res.status(404).json({
                success: false,
                message: `${req.accountType} not found`
            });
        }

        res.json({
            success: true,
            message: `FCM token registered successfully for ${req.accountType}`,
            data: {
                accountType: req.accountType,
                email: updatedAccount.email,
                hasFcmToken: !!updatedAccount.fcmToken
            }
        });
    } catch (error) {
        console.error('FCM token error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// UNIVERSAL DELETE ROUTE
router.delete('/fcm-token', authenticateAny, async (req, res) => {
    try {
        if (req.accountType === 'admin') {
            await Admin.findByIdAndUpdate(req.account._id, { fcmToken: null });
        } else {
            await User.findByIdAndUpdate(req.account._id, { fcmToken: null });
        }

        console.log(`🗑️ FCM token removed for ${req.accountType}: ${req.account.email}`);

        res.json({
            success: true,
            message: `FCM token removed successfully for ${req.accountType}`
        });
    } catch (error) {
        console.error('FCM token delete error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// UNIVERSAL GET ROUTE
router.get('/fcm-token', authenticateAny, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                accountType: req.accountType,
                email: req.account.email,
                hasFcmToken: !!req.account.fcmToken,
                fcmToken: req.account.fcmToken
            }
        });
    } catch (error) {
        console.error('Get FCM token error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

module.exports = router;