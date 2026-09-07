const express = require('express');
const router = express.Router();
// פעולות הבקר שמטפלות בבקשות לוח המודעות.
const noticeBoardController = require('../controllers/noticeBoardController');

// שליפת כל המודעות
// מחזיר את המודעות הקיימות.
router.get('/', noticeBoardController.getNotices);

// הוספת מודעה חדשה ושליחת מייל מעוצב לכל המשתמשות דרך Brevo
// יוצר מודעה ושולח עדכון למשתמשות.
router.post('/', noticeBoardController.createNotice);

// מחיקת הודעה מלוח המודעות
// מוחק מודעה לפי מזהה.
router.delete('/:id', noticeBoardController.deleteNotice);

module.exports = router;