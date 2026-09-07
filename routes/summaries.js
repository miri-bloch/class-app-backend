const express = require('express');
const router = express.Router();
const multer = require('multer');
const summariesController = require('../controllers/summariesController');

// הגדרת Multer לשמירת הקובץ בזיכרון הזמני
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // מגבלה של 10MB
});

// קבלת כל הסיכומים
router.get('/', summariesController.getSummaries);

// העלאת סיכום חדש (השדה בטופס חייב להיקרא 'file')
router.post('/upload', upload.single('file'), summariesController.uploadSummary);

module.exports = router;