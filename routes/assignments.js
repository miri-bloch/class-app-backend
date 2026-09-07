const express = require('express');
const router = express.Router();
const multer = require('multer');
const assignmentsController = require('../controllers/assignmentsController');

// Multer שומר קבצים מצורפים בזיכרון לפני העברתם לשירות Drive.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// מחזיר את רשימת המטלות.
router.get('/', assignmentsController.getAssignments);
// יוצר מטלה עם אפשרות לקובץ מצורף.
router.post('/', upload.single('attachment'), assignmentsController.createAssignment);
// מעדכן את ההערה האישית של מטלה.
router.post('/:id/note', assignmentsController.updateAssignmentNote);
// מחזיר סטטיסטיקות ביצוע כיתתיות.
router.get('/stats/completion', assignmentsController.getCompletionStats);
// מוחק מטלה לפי מזהה.
router.delete('/:id', assignmentsController.deleteAssignment);

module.exports = router;