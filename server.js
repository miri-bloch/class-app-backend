const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const pool = require('./db');
const initScheduler = require('./services/scheduler');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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