// ספריות התשתית של שרת Express והגשת קבצי frontend.
const express = require('express');
const cors = require('cors');
const path = require('path');

// Routers שמרכזים את כתובות ה-API לפי תחום אחריות.
// נתיבי משתמשות, התחברות והגדרות מנהלה.
const authRoutes = require('./routes/auth');
// נתיבי מטלות, הערות אישיות וסטטיסטיקות.
const assignmentRoutes = require('./routes/assignments');
// נתיבי תורנות החלב.
const milkRoutes = require('./routes/milk');
// נתיבי לוח המודעות.
const noticeRoutes = require('./routes/noticeBoard');
// נתיבי הסיכומים והעלאת הקבצים.
const summaryRoutes = require('./routes/summaries');
// Middleware שמתעד כל בקשה שהגיעה לשרת.
const requestLogger = require('./middleware/requestLogger');

// אובייקט האפליקציה שעליו נרשמים ה-middleware וה-routes.
const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(express.static(path.join(__dirname, 'frontend')));

// מציג את מסך ה-frontend הראשי בכניסה לאתר.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/milk', milkRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/summaries', summaryRoutes);

// מחזיר תשובת בדיקה קצרה כדי לוודא שהשרת פעיל.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'השרת עובד מצוין!' });
});

module.exports = app;