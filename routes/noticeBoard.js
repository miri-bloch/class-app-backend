const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');
const { uploadFileToDrive } = require('../services/driveService');
const { sendBrandedEmail, sendBrandedEmailWithAttachment } = require('../services/emailService');
const { auth, optionalAuth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function normalizeFilename(filename) {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return /[\u0590-\u05FF]/.test(decoded) ? decoded : filename;
}

// שליפת כל המודעות
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.*, u.full_name as author_name
       FROM notice_board n
       LEFT JOIN users u ON n.author_id = u.id
       ORDER BY n.is_important DESC, n.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת המודעות' });
  }
});

// הוספת מודעה חדשה ושליחת מייל מעוצב לכל המשתמשות דרך Brevo
router.post('/', optionalAuth, upload.single('attachment'), async (req, res) => {
  const { title, content, is_important } = req.body;
  // זהות סמכותית מהטוקן אם קיים (במוד תאימות — מה-body)
  const author_id = req.user?.id ?? req.body.author_id;

  if (!author_id) {
    return res.status(401).json({ error: 'נדרשת התחברות לפרסום מודעה' });
  }

  try {
    const attachmentName = req.file ? normalizeFilename(req.file.originalname) : null;
    const driveData = req.file
      ? await uploadFileToDrive({ ...req.file, originalname: attachmentName })
      : null;
    const newNotice = await pool.query(
      `INSERT INTO notice_board (
         author_id, title, content, is_important,
         drive_file_id, drive_web_view_link, attachment_name
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        author_id,
        title,
        content,
        is_important || false,
        driveData?.id || null,
        driveData?.webViewLink || null,
        attachmentName
      ]
    );

    // שליחת מייל אוטומטי לכל המשתמשות הרשומות דרך Brevo
    const usersResult = await pool.query('SELECT email FROM users WHERE email IS NOT NULL');
    let emailFailures = 0;
    for (const user of usersResult.rows) {
      try {
        const contentHtml = `
          <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">📢 ${title}</div>
          <div style="font-size: 15px; color: #d1d5db; line-height: 1.6;">${content}</div>
        `;
        const subject = `📢 הודעה חדשה בלוח המודעות: ${title}`;
        if (req.file) {
          await sendBrandedEmailWithAttachment(
            user.email,
            subject,
            'CLASS SYSTEM NOTIFICATION',
            contentHtml,
            { buffer: req.file.buffer, name: attachmentName, mimeType: req.file.mimetype }
          );
        } else {
          await sendBrandedEmail(user.email, subject, 'CLASS SYSTEM NOTIFICATION', contentHtml);
        }
      } catch (mailErr) {
        emailFailures += 1;
        console.error('שגיאה בשליחת מייל למשתמשת:', user.email, mailErr);
      }
    }

    res.status(201).json({ ...newNotice.rows[0], email_failures: emailFailures });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהוספת מודעה ושליחת מייל' });
  }
});

// מחיקת הודעה מלוח המודעות
router.delete('/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM notice_board WHERE id = $1', [id]);
    res.json({ message: 'ההודעה הוסרה בהצלחה' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה במחיקת ההודעה' });
  }
});

module.exports = router;