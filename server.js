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

// הגדרת תיקיית ה-frontend כתיקייה סטטית כדי ששאר הקבצים (CSS, JS) ייטענו נכון
app.use(express.static(path.join(__dirname, 'frontend')));

// הגדרת נתיב ברירת מחדל שמציג את קובץ ה-index.html בכניסה לאתר
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// תיקון נדרש בראש קובץ השרת (server.js או index.js) לפתרון תקלת שליחת המיילים בענן של Render:

const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // פותר את בעיית ה-IPv6 בשרתי ענן

// בעת הגדרת Nodemailer בשרת, יש לוודא שמוגדר family: 4:
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  family: 4 // מכריח שימוש ב-IPv4 בלבד ועוקף את שגיאת ENETUNREACH
});


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

// חיבור כל הנתיבים (Routes) לקידומת ה-API שלהם ב-Express
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