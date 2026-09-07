const pool = require('../data/db');
const { sendBrandedEmail } = require('../services/emailService');

async function getNotices(req, res) {
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
}

async function createNotice(req, res) {
  const { author_id, title, content, is_important } = req.body;

  try {
    const newNotice = await pool.query(
      `INSERT INTO notice_board (author_id, title, content, is_important)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [author_id, title, content, is_important || false]
    );

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
}

async function deleteNotice(req, res) {
  try {
    await pool.query('DELETE FROM notice_board WHERE id = $1', [req.params.id]);
    res.json({ message: 'ההודעה הוסרה בהצלחה' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה במחיקת ההודעה' });
  }
}

module.exports = { getNotices, createNotice, deleteNotice };