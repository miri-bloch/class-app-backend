const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const pool = require('./db');
const initScheduler = require('./services/scheduler');
const path = require('path');
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// הגדרת תיקיית ה-frontend כתיקייה סטטית
app.use(express.static(path.join(__dirname, 'frontend')));

// הגדרת נתיב ברירת מחדל שמציג את קובץ ה-index.html בכניסה לאתר
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// פונקציית שליחת מייל דרך Brevo API
async function sendEmailViaBrevo(toEmail, toName, subject, htmlContent) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { 
        name: "DevSpace System",
        email: process.env.SENDER_EMAIL || "no-reply@yourdomain.com" 
      },
      to: [{ email: toEmail, name: toName || 'משתמשת' }],
      subject: subject,
      htmlContent: htmlContent
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || 'שגיאה בשליחת מייל דרך Brevo');
  }

  return await response.json();
}

app.locals.sendEmail = sendEmailViaBrevo;

// הפעלת מתזמן המיילים האוטומטי
initScheduler();

// בדיקת חיבור למסד הנתונים
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('שגיאה בהתחברות למסד הנתונים:', err);
  } else {
    console.log('התחברות למסד הנתונים הצליחה! השעה במסד:', res.rows[0].now);
  }
});

// ייבוא כל קבצי הראוטרים
const authRoutes = require('./routes/auth');
const assignmentRoutes = require('./routes/assignments');
const milkRoutes = require('./routes/milk');
const noticeRoutes = require('./routes/noticeBoard');
const summaryRoutes = require('./routes/summaries');

// חיבור כל הנתיבים (Routes) לקידומת ה-API שלהם
app.use('/api/auth', authRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/milk', milkRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/summaries', summaryRoutes);

// בדיקת בריאות השרת
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'השרת עובד מצוין!' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});