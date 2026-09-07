const pool = require('../data/db');
const { uploadFileToDrive } = require('../services/driveService');

async function getSummaries(req, res) {
  try {
    const result = await pool.query(
      `SELECT s.*, u.full_name as uploader_name
       FROM summaries s
       LEFT JOIN users u ON s.uploaded_by = u.id
       ORDER BY s.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('שגיאה בשליפת הסיכומים:', err);
    res.status(500).json({ error: 'שגיאה בשליפת הסיכומים' });
  }
}

async function uploadSummary(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'לא צורף קובץ להעלאה' });

    const { title, uploader_id } = req.body;
    const subject = req.body.subject || 'כללי';
    console.log(`מנסה להעלות קובץ ל-Google Drive: ${req.file.originalname}`);

    let driveData;
    try {
      driveData = await uploadFileToDrive(req.file);
    } catch (googleErr) {
      console.error('*** שגיאה מול ה-API של Google Drive ***', googleErr.message);
      return res.status(500).json({
        error: 'שגיאה בהתחברות ל-Google Drive. ודאי שתיקיית הדרייב משותפת עם המייל של חשבון השירות',
        details: googleErr.message
      });
    }

    const newSummary = await pool.query(
      `INSERT INTO summaries (subject, title, drive_file_id, drive_web_view_link, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [subject, title, driveData.id, driveData.webViewLink, uploader_id || null]
    );

    res.status(201).json({ message: 'הסיכום הועלה בהצלחה!', summary: newSummary.rows[0] });
  } catch (err) {
    console.error('שגיאה כללית בהעלאה:', err);
    res.status(500).json({ error: 'שגיאת שרת פנימית', details: err.message });
  }
}

module.exports = { getSummaries, uploadSummary };