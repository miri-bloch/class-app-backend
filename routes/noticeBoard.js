const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendEmail } = require('../services/emailService');

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
router.post('/', async (req, res) => {
  const { author_id, title, content, is_important } = req.body;

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
        const htmlContent = `
          <div dir="rtl" style="background-color: #050508; color: #ffffff; padding: 30px; border-radius: 16px; border: 1px solid rgba(34, 211, 238, 0.3); font-family: 'Heebo', Arial, sans-serif;">
            <div style="text-align: center; margin-bottom: 20px;">
              <span style="color: #22d3ee; font-size: 24px; font-weight: 900;">// Dev</span><span style="color: #c084fc; font-size: 24px; font-weight: 900;">Space</span>
              <div style="font-size: 11px; color: #d1d5db; letter-spacing: 2px; text-transform: uppercase; margin-top: 5px;">Class System Notification</div>
            </div>
            <div style="background: rgba(13, 13, 20, 0.8); padding: 20px; border-radius: 12px; border-right: 4px solid #c084fc;">
              <h3 style="color: #22d3ee; margin-top: 0; font-size: 18px;">${title}</h3>
              <p style="font-size: 15px; color: #d1d5db; line-height: 1.6;">${content}</p>
            </div>
            <div style="text-align: center; margin-top: 25px; font-size: 12px; color: #d1d5db; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 15px;">
              כל הזכויות שמורות © M BLOCH - DevSpace
            </div>
          </div>
        `;
        await sendEmail(user.email, `📢 הודעה חדשה בלוח המודעות: ${title}`, htmlContent, 'אפליקציית הכיתה');
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
router.delete('/:id', async (req, res) => {
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