const express = require('express');
const router = express.Router();
// פעולות הבקר שמטפלות בבקשות המשתמשות.
const authController = require('../controllers/authController');

// מעדכן את מספר המשתמשות הפעילות.
router.post('/heartbeat', authController.heartbeat);

// מחזיר את העדפות ההתראות של משתמשת.
router.get('/notification-settings/:userId', authController.getNotificationSettings);

// מעדכן את העדפות ההתראות של משתמשת.
router.patch('/notification-settings/:userId', authController.updateNotificationSettings);

// הרשמה למערכת
// רושם משתמשת חדשה במערכת.
router.post('/register', authController.register);

// התחברות למערכת
// מבצע התחברות למערכת.
router.post('/login', authController.login);

// שליפת כל המשתמשות עבור פאנל הניהול
// מחזיר את רשימת המשתמשות למנהלה.
router.get('/users', authController.getUsers);

// מחיקת משתמשת לפי ID מתוך פאנל הניהול
// מוחק משתמשת לפי מזהה.
router.delete('/users/:id', authController.deleteUser);

// שכחתי סיסמה - שליחת המייל המעוצב
// שולח הודעת שחזור סיסמה.
router.post('/forgot-password', authController.forgotPassword);

// שליחת מייל מעוצב לכתובת אחת מאזור המנהלת
// שולח מייל יזום מאזור המנהלה.
router.post('/admin/send-email', authController.sendAdminEmail);

module.exports = router;