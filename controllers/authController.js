// חיבור למסד הנתונים ושירותי שליחת המיילים של המשתמשות.
const pool = require('../data/db');
const { sendPasswordResetEmail, sendBrandedEmail } = require('../services/emailService');

// זיכרון זמני של משתמשות ששלחו heartbeat לאחרונה.
const activeUsers = new Map();
// סיסמת המנהלה עבור פעולות הניהול הקיימות במערכת.
const ADMIN_PASSWORD = '123';

// מעדכן את המשתמשות הפעילות ומחזיר את מספרן.
function heartbeat(req, res) {
  const { userId } = req.body;
  if (userId) activeUsers.set(userId, Date.now());

  const now = Date.now();
  for (const [id, time] of activeUsers.entries()) {
    if (now - time > 60000) activeUsers.delete(id);
  }

  res.json({ onlineCount: activeUsers.size });
}

// מחזיר את העדפת קבלת המיילים של משתמשת.
async function getNotificationSettings(req, res) {
  try {
    const result = await pool.query('SELECT email_notifications FROM users WHERE id = $1', [req.params.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('שגיאה בטעינת הגדרות מייל:', err);
    res.status(500).json({ error: 'שגיאה בטעינת הגדרות המייל' });
  }
}

// מעדכן את העדפת קבלת המיילים של משתמשת.
async function updateNotificationSettings(req, res) {
  const { email_notifications } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET email_notifications = $1 WHERE id = $2 RETURNING email_notifications',
      [Boolean(email_notifications), req.params.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('שגיאה בעדכון הגדרות מייל:', err);
    res.status(500).json({ error: 'שגיאה בעדכון הגדרות המייל' });
  }
}

// יוצר משתמשת חדשה לאחר בדיקת מייל קיים.
async function register(req, res) {
  const { full_name, email, password } = req.body;
  try {
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'כתובת המייל כבר קיימת במערכת' });

    const newUser = await pool.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name, email',
      [full_name, email, password]
    );
    res.status(201).json({ message: 'ההרשמה בוצעה בהצלחה', user: newUser.rows[0] });
  } catch (err) {
    console.error('שגיאה בהרשמה:', err);
    res.status(500).json({ error: 'שגיאת שרת בהרשמה' });
  }
}

// בודק פרטי התחברות ומחזיר את פרטי המשתמשת.
async function login(req, res) {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0 || result.rows[0].password_hash !== password) {
      return res.status(400).json({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const user = result.rows[0];
    res.json({ message: 'התחברת בהצלחה', user: { id: user.id, full_name: user.full_name, email: user.email } });
  } catch (err) {
    console.error('שגיאה בהתחברות:', err);
    res.status(500).json({ error: 'שגיאת שרת בהתחברות' });
  }
}

// מחזיר את רשימת המשתמשות עבור אזור הניהול.
async function getUsers(req, res) {
  try {
    const result = await pool.query('SELECT id, full_name, email FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('שגיאה בשליפת משתמשות:', err);
    res.status(500).json({ error: 'שגיאה בשליפת רשימת המשתמשות' });
  }
}

// מוחק משתמשת לפי מזהה.
async function deleteUser(req, res) {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'המשתמשת הוסרה בהצלחה' });
  } catch (err) {
    console.error('שגיאה במחיקת משתמשת:', err);
    res.status(500).json({ error: 'שגיאה במחיקת המשתמשת' });
  }
}

// שולח למשתמשת את פרטי שחזור הסיסמה במייל.
async function forgotPassword(req, res) {
  const { email } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'כתובת המייל אינה קיימת במערכת' });

    const user = result.rows[0];
    await sendPasswordResetEmail(email, user.full_name, user.password_hash);
    res.json({ message: 'הסיסמה נשלחה בהצלחה לכתובת המייל שלך!' });
  } catch (err) {
    console.error('שגיאה בשחזור סיסמה:', err);
    res.status(500).json({ error: 'שגיאת שרת בתהליך שחזור הסיסמה' });
  }
}

// בודק הרשאת מנהלה ושולח מייל לנמענות שנבחרו.
async function sendAdminEmail(req, res) {
  const { adminPassword, toEmail, subject, content } = req.body;
  if (adminPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: 'אין הרשאה לשליחת מייל' });

  const recipients = typeof toEmail === 'string'
    ? toEmail.split(/[\s,;]+/).map(email => email.trim()).filter(Boolean)
    : Array.isArray(toEmail) ? toEmail.filter(Boolean) : [];

  if (recipients.length === 0 || !subject || !content) return res.status(400).json({ error: 'יש למלא כתובת, נושא ותוכן' });
  if (recipients.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
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
}

// מייצא את פעולות המשתמשות לשכבת ה-routes.
module.exports = { heartbeat, getNotificationSettings, updateNotificationSettings, register, login, getUsers, deleteUser, forgotPassword, sendAdminEmail };