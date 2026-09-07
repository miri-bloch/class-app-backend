const express = require('express');
const router = express.Router();
const multer = require('multer');
const assignmentsController = require('../controllers/assignmentsController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.get('/', assignmentsController.getAssignments);
router.post('/', upload.single('attachment'), assignmentsController.createAssignment);
router.post('/:id/note', assignmentsController.updateAssignmentNote);
router.get('/stats/completion', assignmentsController.getCompletionStats);
router.delete('/:id', assignmentsController.deleteAssignment);

module.exports = router;