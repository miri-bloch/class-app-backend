const express = require('express');
const router = express.Router();
const pool = require('../db');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

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

// סימון התורנות כבוצעה, העברה אוטומטית לבת הבאה ושליחת מייל תזכורת מעוצב
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
          await transporter.sendMail({
            from: `"אפליקציית הכיתה" <${process.env.EMAIL_USER}>`,
            to: nextUser.email,
            subject: '🥛 תורן חלב - הגיע תורך!',
            html: `
              <div dir="rtl" style="background-color: #050508; color: #ffffff; padding: 30px; border-radius: 16px; border: 1px solid rgba(34, 211, 238, 0.3); font-family: 'Heebo', Arial, sans-serif;">
                <div style="text-align: center; margin-bottom: 20px;">
                  <span style="color: #22d3ee; font-size: 24px; font-weight: 900;">// Dev</span><span style="color: #c084fc; font-size: 24px; font-weight: 900;">Space</span>
                  <div style="font-size: 11px; color: #d1d5db; letter-spacing: 2px; text-transform: uppercase; margin-top: 5px;">Milk Duty Notification</div>
                </div>
                <div style="background: rgba(13, 13, 20, 0.8); padding: 20px; border-radius: 12px; border-right: 4px solid #22d3ee;">
                  <h3 style="color: #22d3ee; margin-top: 0; font-size: 18px;">שלום ${nextUser.full_name}, הגיע תורך בתורנות החלב! 🥛</h3>
                  <p style="font-size: 15px; color: #d1d5db; line-height: 1.6;">התור הקודם הושלם בהצלחה, כעת עליך לדאוג לרכש החלב עבור הכיתה.</p>
                </div>
                <div style="text-align: center; margin-top: 25px; font-size: 12px; color: #d1d5db; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 15px;">
                  כל הזכויות שמורות © M BLOCH - DevSpace
                </div>
              </div>
            `
          });
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