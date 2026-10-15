// אזור אישי — העלאת קבצים ושיוכם למקצוע.
//
// חשוב לאבטחה: כל קובץ מועלה לדרייב של בעלת המערכת אך **בלי שיתוף ציבורי**,
// והשליפה מותאמת לפי user_id מתוך הטוקן. כך קבצים של משתמשת אחת אינם נגישים
// לאחרת, גם אם יש לה את מזהה הקובץ.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');
const { uploadFileToDrive, downloadFileFromDrive, deleteFileFromDrive, getOrCreateFolder } = require('../services/driveService');
const { auth } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

function normalizeFilename(filename) {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return /[֐-׿]/.test(decoded) ? decoded : filename;
}

// תיקיית האב ביומן האישי — כל הקבצים האישיים יושבים תחתיה כדי לא להתערבב
// עם קבצי המטלות והמודעות.
async function getPersonalRootFolderId() {
  const base = process.env.GOOGLE_DRIVE_FOLDER_ID;
  return getOrCreateFolder('קבצים אישיים', base ? base.trim() : null);
}

// 1. שליפת הקבצים של המשתמשת המחוברת בלבד (עם סינון אופציונלי לפי מקצוע)
router.get('/', auth, async (req, res) => {
  const userId = req.user.id;
  const { subject } = req.query;

  try {
    const params = [userId];
    let where = 'WHERE user_id = $1';
    if (subject) {
      params.push(subject);
      where += ` AND subject = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT id, subject, file_name, mime_type, size_bytes, created_at
       FROM personal_files ${where}
       ORDER BY created_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת הקבצים האישיים' });
  }
});

// 2. העלאת קובץ או כמה קבצים בבת אחת, עם שיוך למקצוע
router.post('/', auth, upload.array('files', 10), async (req, res) => {
  const userId = req.user.id;
  const { subject } = req.body;

  if (!subject) {
    return res.status(400).json({ error: 'יש לבחור מקצוע לפני העלאת קובץ' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'לא נבחרו קבצים להעלאה' });
  }

  const uploaded = [];
  try {
    const rootFolderId = await getPersonalRootFolderId();
    const subjectFolderId = await getOrCreateFolder(subject, rootFolderId);

    for (const file of req.files) {
      const fileName = normalizeFilename(file.originalname);
      const driveData = await uploadFileToDrive(
        { ...file, originalname: fileName },
        { parentFolderId: subjectFolderId, makePublic: false }
      );

      // תיקיית המשתמשת נשמרת כהורה נוסף לצורך ארגון ויזואלי בדרייב
      const row = await pool.query(
        `INSERT INTO personal_files
           (user_id, subject, file_name, drive_file_id, drive_folder_id, mime_type, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, subject, file_name, mime_type, size_bytes, created_at`,
        [userId, subject, fileName, driveData.id, subjectFolderId, file.mimetype, file.size]
      );
      uploaded.push(row.rows[0]);
    }

    res.status(201).json(uploaded);
  } catch (err) {
    console.error(err);
    // אם חלק מהקבצים כבר עלו — מחזירים את מה שנשמר כדי שהממשק לא יציג כשל מלא
    if (uploaded.length) {
      return res.status(207).json({ files: uploaded, error: 'חלק מהקבצים הועלו וחלק נכשלו' });
    }
    res.status(500).json({ error: 'שגיאה בהעלאת הקבצים' });
  }
});

// 3. הורדת קובץ אישי — מורשה רק לבעלת הקובץ
router.get('/:id/download', auth, async (req, res) => {
  const userId = req.user.id;
  const fileId = req.params.id;

  try {
    const result = await pool.query(
      'SELECT drive_file_id, file_name, mime_type FROM personal_files WHERE id = $1 AND user_id = $2',
      [fileId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'הקובץ לא נמצא' });
    }

    const file = result.rows[0];
    const buffer = await downloadFileFromDrive(file.drive_file_id);

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהורדת הקובץ' });
  }
});

// 4. מחיקת קובץ אישי — מורשה רק לבעלת הקובץ
router.delete('/:id', auth, async (req, res) => {
  const userId = req.user.id;
  const fileId = req.params.id;

  try {
    const result = await pool.query(
      'DELETE FROM personal_files WHERE id = $1 AND user_id = $2 RETURNING drive_file_id',
      [fileId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'הקובץ לא נמצא' });
    }

    // מחיקה מהדרייב היא "מיטב המאמץ" — גם אם תיכשל, הרשומה כבר הוסרה מהמערכת
    try {
      await deleteFileFromDrive(result.rows[0].drive_file_id);
    } catch (driveErr) {
      console.error('הקובץ הוסר מהמערכת אך המחיקה מהדרייב נכשלה:', driveErr.message);
    }

    res.json({ message: 'הקובץ נמחק בהצלחה' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה במחיקת הקובץ' });
  }
});

module.exports = router;
