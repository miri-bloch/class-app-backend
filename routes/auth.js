const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/heartbeat', authController.heartbeat);

router.get('/notification-settings/:userId', authController.getNotificationSettings);

router.patch('/notification-settings/:userId', authController.updateNotificationSettings);

// הרשמה למערכת
router.post('/register', authController.register);

// התחברות למערכת
router.post('/login', authController.login);

// שליפת כל המשתמשות עבור פאנל הניהול
router.get('/users', authController.getUsers);

// מחיקת משתמשת לפי ID מתוך פאנל הניהול
router.delete('/users/:id', authController.deleteUser);

// שכחתי סיסמה - שליחת המייל המעוצב
router.post('/forgot-password', authController.forgotPassword);

// שליחת מייל מעוצב לכתובת אחת מאזור המנהלת
router.post('/admin/send-email', authController.sendAdminEmail);

module.exports = router;