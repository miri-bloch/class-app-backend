const express = require('express');
const router = express.Router();
const multer = require('multer');
// פעולות הבקר שמטפלות בשליפת ובהעלאת סיכומים.
const summariesController = require('../controllers/summariesController');

// Multer שומר את קובץ הסיכום בזיכרון לפני העלאה ל-Drive.
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // מגבלה של 10MB
});

// מחזיר את הסיכומים הקיימים.
router.get('/', summariesController.getSummaries);

// מעלה סיכום חדש דרך שדה טופס בשם file.
router.post('/upload', upload.single('file'), summariesController.uploadSummary);

module.exports = router;