const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');
const { uploadFileToDrive, downloadFileFromDrive } = require('../services/driveService');
const { auth, optionalAuth } = require('../middleware/auth');
const { sendBrandedEmailWithAttachment } = require('../services/emailService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function normalizeFilename(filename) {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return /[\u0590-\u05FF]/.test(decoded) ? decoded : filename;
}

async function removeExpiredAssignments() {
  await pool.query(`
    DELETE FROM assignments
    WHERE due_date < CURRENT_DATE - 2
  `);
}

// 1. קבלת כל המטלות (כולל הערות אישיות וסימון V למשתמשת מסוימת)
router.get('/', optionalAuth, async (req, res) => {
  // זהות סמכותית מהטוקן אם קיים (להתאמה אישית), אחרת (לגאסי) מהשאילתא
  const userId = req.user?.id ?? req.query.userId ?? null;

  try {
    await removeExpiredAssignments();
    const result = await pool.query(
      `SELECT a.*,
              pn.is_completed,
              pn.note_text,
              (SELECT COUNT(*) FROM private_notes pc
                WHERE pc.assignment_id = a.id AND pc.is_completed = TRUE) AS completed_count,
              (SELECT COUNT(DISTINCT u.id) FROM users u) AS total_users
       FROM assignments a
       LEFT JOIN private_notes pn ON a.id = pn.assignment_id AND pn.user_id = $1
       ORDER BY a.due_date ASC`,
      [userId]
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
    const attachmentName = req.file ? normalizeFilename(req.file.originalname) : null;
    if (req.file) {
      driveData = await uploadFileToDrive({ ...req.file, originalname: attachmentName });
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
        attachmentName
      ]
    );

    res.status(201).json(newAssignment.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהוספת המטלה' });
  }
});

// 3. עדכון סימון V / הערה אישית למשתמשת
router.post('/:id/note', optionalAuth, async (req, res) => {
  const assignmentId = req.params.id;
  const { note_text, is_completed } = req.body;
  // זהות סמכותית מהטוקן אם קיים (במוד תאימות — מה-body)
  const userId = req.user?.id ?? req.body.userId ?? null;

  if (!userId) {
    return res.status(401).json({ error: 'נדרשת התחברות לסימון מטלה' });
  }

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
      `SELECT a.id, a.subject, a.title,
              COUNT(pn.id) FILTER (WHERE pn.is_completed = TRUE) as completed_count,
              (SELECT COUNT(*) FROM users) as total_users
       FROM assignments a
       LEFT JOIN private_notes pn ON a.id = pn.assignment_id
      GROUP BY a.id, a.subject, a.title`
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

// 6. שליחת קובץ המטלה למייל של המשתמשת המחוברת
router.post('/:id/send-to-email', auth, async (req, res) => {
  const assignmentId = req.params.id;
  const userId = req.user?.id;

  try {
    const result = await pool.query(
      'SELECT * FROM assignments WHERE id = $1',
      [assignmentId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'המטלה לא נמצאה' });
    }

    const assignment = result.rows[0];
    if (!assignment.drive_file_id) {
      return res.status(400).json({ error: 'למטלה זו אין קובץ מצורף' });
    }

    // מיילה של המשתמשת המחוברת
    const userRes = await pool.query(
      'SELECT full_name, email FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    }
    const user = userRes.rows[0];

    // הורדת הקובץ מ-Google Drive
    const buffer = await downloadFileFromDrive(assignment.drive_file_id);
    const fileName = assignment.attachment_name || 'קובץ שיעור';

    const contentHtml = `
      <div style="font-size: 16px; color: #cbd5e1; margin-bottom: 10px;">שלום ${user.full_name},</div>
      <div style="font-size: 14px; color: #94a3b8; line-height: 1.6;">צורפה למייל זה מטלה: ${assignment.title} (${assignment.subject || 'כללי'}).</div>
    `;

    await sendBrandedEmailWithAttachment(
      user.email,
      `📎 קובץ המטלה: ${assignment.title}`,
      'ASSIGNMENT FILE',
      contentHtml,
      { buffer, name: fileName, mimeType: undefined }
    );

    res.json({ message: 'הקובץ נשלח בהצלחה למייל שלך!' });
  } catch (err) {
    console.error('שגיאה בשליחת הקובץ למייל:', err);
    if (err && err.isDriveError) {
      return res.status(500).json({ error: 'שגיאה בהורדת הקובץ מהדרייב' });
    }
    res.status(500).json({ error: 'שגיאה בשליחת הקובץ למייל' });
  }
});

module.exports = router;