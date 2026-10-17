const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');
const { uploadFileToDrive, downloadFileFromDrive } = require('../services/driveService');
const { sendBrandedEmail, sendBrandedEmailWithAttachment } = require('../services/emailService');
const { auth, optionalAuth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// מקבל גם את השדה החדש (attachments, מרובה) וגם את הישן (attachment, בודד)
const uploadAttachments = upload.fields([
  { name: 'attachments', maxCount: 10 },
  { name: 'attachment', maxCount: 1 }
]);

function collectUploadedFiles(req) {
  const grouped = req.files || {};
  return [...(grouped.attachments || []), ...(grouped.attachment || [])];
}

function normalizeFilename(filename) {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return /[\u0590-\u05FF]/.test(decoded) ? decoded : filename;
}

// שליפת כל המודעות
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.*, u.full_name as author_name,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'id', f.id,
                          'original_name', f.original_name,
                          'drive_web_view_link', f.drive_web_view_link
                        ) ORDER BY f.id)
                   FROM notice_files f WHERE f.notice_id = n.id),
                '[]'::json
              ) AS files
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
router.post('/', optionalAuth, uploadAttachments, async (req, res) => {
  const { title, content, is_important } = req.body;
  // זהות סמכותית מהטוקן אם קיים (במוד תאימות — מה-body)
  const author_id = req.user?.id ?? req.body.author_id;
  const files = collectUploadedFiles(req);

  if (!author_id) {
    return res.status(401).json({ error: 'נדרשת התחברות לפרסום מודעה' });
  }

  try {
    const newNotice = await pool.query(
      `INSERT INTO notice_board (author_id, title, content, is_important)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [author_id, title, content, is_important || false]
    );

    const noticeId = newNotice.rows[0].id;
    const savedFiles = [];

    // כל קובץ עולה בנפרד; כשל בקובץ אחד לא מבטל את שאר ההעלאה
    for (const file of files) {
      const attachmentName = normalizeFilename(file.originalname);
      try {
        const driveData = await uploadFileToDrive({ ...file, originalname: attachmentName });
        const row = await pool.query(
          `INSERT INTO notice_files
             (notice_id, original_name, drive_file_id, drive_web_view_link, mime_type)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [noticeId, attachmentName, driveData.id, driveData.webViewLink || null, file.mimetype]
        );
        savedFiles.push(row.rows[0]);
      } catch (fileErr) {
        console.error(`שגיאה בהעלאת קובץ למודעה ${noticeId}:`, fileErr.message);
      }
    }

    // שמירת הקובץ הראשון בשדות הישנים לתאימות לאחור
    const first = savedFiles[0];
    if (first) {
      await pool.query(
        `UPDATE notice_board
            SET drive_file_id = $1, drive_web_view_link = $2, attachment_name = $3
          WHERE id = $4`,
        [first.drive_file_id, first.drive_web_view_link, first.original_name, noticeId]
      );
    }

    // רשימת קישורים לכל הקבצים שצורפו למודעה (המייל מצרף את הראשון ומקשר לשאר)
    const attachmentsHtml = savedFiles.length
      ? `<div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid #e2e8f0;">
           <div style="font-size: 14px; color: #64748b; margin-bottom: 8px;">📎 קבצים מצורפים:</div>
           ${savedFiles.map(f => `<div style="margin-bottom: 4px;"><a href="${f.drive_web_view_link}" style="color: #0e7490;">${f.original_name}</a></div>`).join('')}
         </div>`
      : '';

    // שליחת מייל אוטומטי לכל המשתמשות הרשומות דרך Brevo
    const usersResult = await pool.query('SELECT email FROM users WHERE email IS NOT NULL');
    let emailFailures = 0;
    for (const user of usersResult.rows) {
      try {
        const contentHtml = `
          <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">📢 ${title}</div>
          <div style="font-size: 15px; color: #d1d5db; line-height: 1.6;">${content}</div>
          ${attachmentsHtml}
        `;
        const subject = `📢 הודעה חדשה בלוח המודעות: ${title}`;
        if (files[0]) {
          await sendBrandedEmailWithAttachment(
            user.email,
            subject,
            'CLASS SYSTEM NOTIFICATION',
            contentHtml,
            { buffer: files[0].buffer, name: normalizeFilename(files[0].originalname), mimeType: files[0].mimetype }
          );
        } else {
          await sendBrandedEmail(user.email, subject, 'CLASS SYSTEM NOTIFICATION', contentHtml);
        }
      } catch (mailErr) {
        emailFailures += 1;
        console.error('שגיאה בשליחת מייל למשתמשת:', user.email, mailErr);
      }
    }

    res.status(201).json({ ...newNotice.rows[0], files: savedFiles, email_failures: emailFailures });
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

// שליחת קובץ מצורף של מודעה למייל של המשתמשת המחוברת בלבד.
// הכתובת נלקחת מהמשתמשת — אין אפשרות לשלוח לכתובת שרירותית.
router.post('/files/:fileId/send-to-email', auth, async (req, res) => {
  const userId = req.user.id;
  const { fileId } = req.params;

  try {
    const fileRes = await pool.query(
      `SELECT f.original_name, f.drive_file_id, f.mime_type, n.title
       FROM notice_files f
       JOIN notice_board n ON n.id = f.notice_id
       WHERE f.id = $1`,
      [fileId]
    );
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'הקובץ לא נמצא' });
    }
    const file = fileRes.rows[0];

    const userRes = await pool.query(
      'SELECT full_name, email FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    }
    const user = userRes.rows[0];

    const buffer = await downloadFileFromDrive(file.drive_file_id);

    const contentHtml = `
      <div style="font-size: 16px; color: #cbd5e1; margin-bottom: 10px;">שלום ${user.full_name},</div>
      <div style="font-size: 14px; color: #94a3b8; line-height: 1.6;">צורף למייל זה הקובץ ${file.original_name} מהמודעה: ${file.title}.</div>
    `;

    await sendBrandedEmailWithAttachment(
      user.email,
      `📎 קובץ מהמודעה: ${file.title}`,
      'NOTICE FILE',
      contentHtml,
      { buffer, name: file.original_name, mimeType: file.mime_type || undefined }
    );

    res.json({ message: 'הקובץ נשלח בהצלחה למייל שלך!' });
  } catch (err) {
    console.error('שגיאה בשליחת קובץ המודעה למייל:', err);
    if (err && err.isFileGone) {
      return res.status(404).json({
        error: 'הקובץ המצורף של המודעה הזו נמחק מהדרייב ולכן אינו זמין יותר. יש להעלות את המודעה מחדש.',
        fileGone: true,
      });
    }
    if (err && err.isDriveError) {
      return res.status(502).json({ error: 'שגיאה בהורדת הקובץ מהדרייב. נסי שוב בעוד רגע.' });
    }
    res.status(500).json({ error: 'שגיאה בשליחת הקובץ למייל' });
  }
});

module.exports = router;