const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendBrandedEmail } = require('../services/emailService');

// שליפת רשימת התורנויות
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.*, u.full_name, u.email
       FROM milk_duty m
       JOIN users u ON m.user_id = u.id
       ORDER BY m.id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת תורנויות החלב' });
  }
});

// הרשמה לתורנות החלב (הוספה לתור)
router.post('/join', async (req, res) => {
  const { user_id } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM milk_duty WHERE user_id = $1 AND is_completed = FALSE', [user_id]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'את כבר רשומה בתור הפעיל!' });
    }

    const newDuty = await pool.query(
      `INSERT INTO milk_duty (user_id, duty_date, is_completed) VALUES ($1, CURRENT_DATE, FALSE) RETURNING *`,
      [user_id]
    );
    res.status(201).json(newDuty.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהצטרפות לתור' });
  }
});

// סימון התורנות כבוצעה, העברה אוטומטית לבת הבאה ושליחת מייל תזכורת מעוצב דרך Brevo
router.patch('/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { is_completed } = req.body;

  try {
    const updated = await pool.query(
      `UPDATE milk_duty SET is_completed = $1 WHERE id = $2 RETURNING *`,
      [is_completed, id]
    );

    if (is_completed) {
      const nextDutyResult = await pool.query(
        `SELECT m.*, u.full_name, u.email 
         FROM milk_duty m 
         JOIN users u ON m.user_id = u.id 
         WHERE m.is_completed = FALSE AND m.id > $1 
         ORDER BY m.id ASC LIMIT 1`,
        [id]
      );

      if (nextDutyResult.rows.length > 0) {
        const nextUser = nextDutyResult.rows[0];
        try {
          const contentHtml = `
            <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">שלום ${nextUser.full_name}, הגיע תורך בתורנות החלב! 🥛</div>
            <div style="font-size: 15px; color: #d1d5db; line-height: 1.6;">התור הקודם הושלם בהצלחה, כעת עליך לדאוג לרכש החלב עבור הכיתה.</div>
          `;
          await sendBrandedEmail(nextUser.email, '🥛 תורן חלב - הגיע תורך!', 'MILK DUTY NOTIFICATION', contentHtml, 'אפליקציית הכיתה');
        } catch (mailErr) {
          console.error('שגיאה בשליחת מייל לתורנית הבאה:', mailErr);
        }
      }
    }

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בעדכון התורנות' });
  }
});

module.exports = router;