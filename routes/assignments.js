const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');
const { uploadFileToDrive } = require('../services/driveService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// 1. קבלת כל המטלות (כולל הערות אישיות וסימון V למשתמשת מסוימת)
router.get('/', async (req, res) => {
  const { userId } = req.query;

  try {
    const result = await pool.query(
      `SELECT a.*, 
              pn.is_completed, 
              pn.note_text 
       FROM assignments a
       LEFT JOIN private_notes pn ON a.id = pn.assignment_id AND pn.user_id = $1
       ORDER BY a.due_date ASC`,
      [userId || null]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת המטלות' });
  }
});

// 2. הוספת מטלה חדשה
router.post('/', upload.single('attachment'), async (req, res) => {
  const { subject, title, description, due_date, difficulty_level } = req.body;

  try {
    let driveData = null;
    if (req.file) {
      driveData = await uploadFileToDrive(req.file);
    }

    const newAssignment = await pool.query(
      `INSERT INTO assignments (subject, title, description, due_date, difficulty_level, drive_file_id, drive_web_view_link, attachment_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        subject,
        title,
        description,
        due_date,
        difficulty_level,
        driveData?.id || null,
        driveData?.webViewLink || null,
        req.file?.originalname || null
      ]
    );

    res.status(201).json(newAssignment.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהוספת המטלה' });
  }
});

// 3. עדכון סימון V / הערה אישית למשתמשת
router.post('/:id/note', async (req, res) => {
  const assignmentId = req.params.id;
  const { userId, note_text, is_completed } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO private_notes (user_id, assignment_id, note_text, is_completed)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, assignment_id)
       DO UPDATE SET 
         note_text = EXCLUDED.note_text,
         is_completed = EXCLUDED.is_completed,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, assignmentId, note_text || '', is_completed || false]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בעדכון ההערה האישית' });
  }
});

// 4. חישוב אחוזי ביצוע כיתתיים לכל מטלה
router.get('/stats/completion', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.title,
              COUNT(pn.id) FILTER (WHERE pn.is_completed = TRUE) as completed_count,
              (SELECT COUNT(*) FROM users) as total_users
       FROM assignments a
       LEFT JOIN private_notes pn ON a.id = pn.assignment_id
       GROUP BY a.id, a.title`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בחישוב אחוזי הביצוע' });
  }
});

// 5. מחיקת מטלה (הוספת הנתיב החדש שפתר את השגיאה)
router.delete('/:id', async (req, res) => {
  const assignmentId = req.params.id;

  try {
    // מחיקת ההערות האישיות המקושרות למטלה תחילה (כדי למנוע שגיאת Foreign Key)
    await pool.query('DELETE FROM private_notes WHERE assignment_id = $1', [assignmentId]);
    
    // מחיקת המטלה עצמה מטבלת ה-assignments
    const result = await pool.query('DELETE FROM assignments WHERE id = $1 RETURNING *', [assignmentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'המטלה לא נמצאה' });
    }

    res.json({ message: 'המטלה נמחקה בהצלחה' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה במחיקת המטלה' });
  }
});

module.exports = router;