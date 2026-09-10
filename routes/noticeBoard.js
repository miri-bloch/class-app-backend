const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendBrandedEmail } = require('../services/emailService');
const { auth, optionalAuth } = require('../middleware/auth');

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
router.post('/', optionalAuth, async (req, res) => {
  const { title, content, is_important } = req.body;
  // זהות סמכותית מהטוקן אם קיים (במוד תאימות — מה-body)
  const author_id = req.user?.id ?? req.body.author_id;

  if (!author_id) {
    return res.status(401).json({ error: 'נדרשת התחברות לפרסום מודעה' });
  }

  try {
    const newNotice = await pool.query(
      `INSERT INTO notice_board (author_id, title, content, is_important)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [author_id, title, content, is_important || false]
    );

    // שליחת מייל אוטומטי לכל המשתמשות הרשומות דרך Brevo
    const usersResult = await pool.query('SELECT email FROM users WHERE email IS NOT NULL');
    for (const user of usersResult.rows) {
      try {
        const contentHtml = `
          <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">📢 ${title}</div>
          <div style="font-size: 15px; color: #d1d5db; line-height: 1.6;">${content}</div>
        `;
        await sendBrandedEmail(user.email, `📢 הודעה חדשה בלוח המודעות: ${title}`, 'CLASS SYSTEM NOTIFICATION', contentHtml);
      } catch (mailErr) {
        console.error('שגיאה בשליחת מייל למשתמשת:', user.email, mailErr);
      }
    }

    res.status(201).json(newNotice.rows[0]);
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