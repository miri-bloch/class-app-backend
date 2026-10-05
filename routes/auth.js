const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendPasswordResetEmail, sendBrandedEmail } = require('../services/emailService');
const { signToken } = require('../services/tokenService');
const { hashPassword, comparePassword } = require('../services/passwordService');
const { optionalAuth } = require('../middleware/auth');

// ניהול משתמשות מחוברות בזמן אמת (Heartbeat)
const activeUsers = new Map();

const ADMIN_PASSWORD = 'MIRI';

router.post('/heartbeat', optionalAuth, async (req, res) => {
  const userId = req.user?.id ?? req.body.userId;
  if (userId) {
    activeUsers.set(userId, Date.now());
    // עדכון "החיבור/פעילות האחרונה" במסד (גם למי ששומרת סשן בלי להתחבר מחדש)
    pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [userId]).catch(() => {});
  }
  const now = Date.now();
  for (const [id, time] of activeUsers.entries()) {
    if (now - time > 60000) activeUsers.delete(id);
  }
  res.json({ onlineCount: activeUsers.size });
});

router.get('/notification-settings/:userId', optionalAuth, async (req, res) => {
  try {
    // זהות סמכותית מהטוקן אם קיים, אחרת (לגאסי) מהנתיב
    const targetId = req.user?.id ?? req.params.userId;
    const result = await pool.query(
      'SELECT email_notifications FROM users WHERE id = $1',
      [targetId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('שגיאה בטעינת הגדרות מייל:', err);
    res.status(500).json({ error: 'שגיאה בטעינת הגדרות המייל' });
  }
});

router.patch('/notification-settings/:userId', optionalAuth, async (req, res) => {
  const { email_notifications } = req.body;
  try {
    // זהות סמכותית מהטוקן אם קיים, אחרת (לגאסי) מהנתיב
    const targetId = req.user?.id ?? req.params.userId;
    const result = await pool.query(
      'UPDATE users SET email_notifications = $1 WHERE id = $2 RETURNING email_notifications',
      [Boolean(email_notifications), targetId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('שגיאה בעדכון הגדרות מייל:', err);
    res.status(500).json({ error: 'שגיאה בעדכון הגדרות המייל' });
  }
});

// הרשמה למערכת
router.post('/register', async (req, res) => {
  const { full_name, email, password } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'כתובת המייל כבר קיימת במערכת' });
    }

    // גיבוב הסיסמה לפני שמירה — לעולם לא נאחסן סיסמה בשפה ברורה
    const hashedPassword = await hashPassword(password);

    const newUser = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email',
      [full_name, email, hashedPassword]
    );

    const savedUser = newUser.rows[0];
    const token = signToken(savedUser);
    res.status(201).json({ message: 'ההרשמה בוצעה בהצלחה', token, user: savedUser });
  } catch (err) {
    console.error('שגיאה בהרשמה:', err);
    res.status(500).json({ error: 'שגיאת שרת בהרשמה' });
  }
});

// התחברות למערכת
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const user = result.rows[0];
    const ok = await comparePassword(password, user.password_hash);
    if (!ok) {
      return res.status(400).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const safeUser = { id: user.id, full_name: user.full_name, email: user.email };
    const token = signToken(safeUser);
    // רישום החיבור האחרון
    await pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    res.json({ message: 'התחברת בהצלחה', token, user: safeUser });
  } catch (err) {
    console.error('שגיאה בהתחברות:', err);
    res.status(500).json({ error: 'שגיאת שרת בהתחברות' });
  }
});

// שליפת כל המשתמשות עבור פאנל הניהול
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, full_name, email, last_seen, is_student FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('שגיאה בשליפת משתמשות:', err);
    res.status(500).json({ error: 'שגיאה בשליפת רשימת המשתמשות' });
  }
});

// מחיקת משתמשת לפי ID מתוך פאנל הניהול
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'המשתמשת הוסרה בהצלחה' });
  } catch (err) {
    console.error('שגיאה במחיקת משתמשת:', err);
    res.status(500).json({ error: 'שגיאה במחיקת המשתמשת' });
  }
});

// שכחתי סיסמה - שליחת המייל המעוצב
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'כתובת המייל אינה קיימת במערכת' });
    }

    const user = result.rows[0];
    
    // יצירת קוד איפוס חדש בן 4 ספרות. הקוד נשלח במייל, ורק הגיבוב שלו נשמר במסד.
    const resetCode = String(Math.floor(1000 + Math.random() * 9000));
    const hashedCode = await hashPassword(resetCode);

    // עדכון הסיסמה בגיבוב החדש — כך גם משתמשות חדשות וגם ישנות יקבלו קוד שימושי
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedCode, user.id]);

    // שליחת הקוד (4 ספרות) במייל האיפוס החדש
    await sendPasswordResetEmail(email, user.full_name, resetCode);

    res.json({ message: 'קוד איפוס חדש נשלח בהצלחה לכתובת המייל שלך!' });
  } catch (err) {
    console.error('שגיאה בשחזור סיסמה:', err);
    res.status(500).json({ error: 'שגיאת שרת בתהליך שחזור הסיסמה' });
  }
});

// שליחת מייל מעוצב לכתובת אחת מאזור המנהלת
router.post('/admin/send-email', async (req, res) => {
  const { adminPassword, toEmail, subject, content } = req.body;

  if (adminPassword !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: 'אין הרשאה לשליחת מייל' });
  }

  const recipients = typeof toEmail === 'string'
    ? toEmail.split(/[\s,;]+/).map(email => email.trim()).filter(Boolean)
    : Array.isArray(toEmail) ? toEmail.filter(Boolean) : [];

  if (recipients.length === 0 || !subject || !content) {
    return res.status(400).json({ error: 'יש למלא כתובת, נושא ותוכן' });
  }

  const invalidEmail = recipients.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (invalidEmail) {
    return res.status(400).json({ error: 'אחת מכתובות המייל אינה תקינה' });
  }

  try {
    const contentHtml = `
      <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">${subject}</div>
      <div style="font-size: 15px; color: #d1d5db; line-height: 1.7; white-space: pre-line;">${content}</div>
    `;

    await sendBrandedEmail(recipients, subject, 'PERSONAL MESSAGE', contentHtml);
    res.json({ message: `המייל נשלח בהצלחה ל-${recipients.length} נמענות` });
  } catch (err) {
    console.error('שגיאה בשליחת מייל מנהלת:', err);
    res.status(500).json({ error: 'שגיאה בשליחת המייל' });
  }
});

module.exports = router;