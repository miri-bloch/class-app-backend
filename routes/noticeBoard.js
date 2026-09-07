const express = require('express');
const router = express.Router();
const noticeBoardController = require('../controllers/noticeBoardController');

// שליפת כל המודעות
router.get('/', noticeBoardController.getNotices);

// הוספת מודעה חדשה ושליחת מייל מעוצב לכל המשתמשות דרך Brevo
router.post('/', noticeBoardController.createNotice);

// מחיקת הודעה מלוח המודעות
router.delete('/:id', noticeBoardController.deleteNotice);

module.exports = router;