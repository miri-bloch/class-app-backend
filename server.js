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
        name: "HighCode System",
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
const eventRoutes = require('./routes/events');
const personalFileRoutes = require('./routes/personalFiles');
const feedbackRoutes = require('./routes/feedback');

// חיבור כל הנתיבים (Routes) לקידומת ה-API שלהם
app.use('/api/auth', authRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/milk', milkRoutes);
app.use('/api/notices', noticeRoutes);
app.use('/api/summaries', summaryRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/personal-files', personalFileRoutes);
app.use('/api/feedback', feedbackRoutes);

// בדיקת בריאות השרת
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'השרת עובד מצוין!' });
});

const PORT = process.env.PORT || 3000;

pool.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_time TIME DEFAULT '20:00';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_student BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP;
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255);
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT;
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);
  ALTER TABLE notice_board ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255);
  ALTER TABLE notice_board ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT;
  ALTER TABLE notice_board ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);
  CREATE TABLE IF NOT EXISTS shared_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    event_date DATE NOT NULL,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    created_by_name VARCHAR(100) DEFAULT 'משתמשת',
    confirm_count INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE shared_events ADD COLUMN IF NOT EXISTS confirm_count INT DEFAULT 1;
  CREATE INDEX IF NOT EXISTS idx_shared_events_date ON shared_events(event_date);
  CREATE TABLE IF NOT EXISTS event_confirmations (
    event_id INT REFERENCES shared_events(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS milk_rotation (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position INT NOT NULL,
    is_current BOOLEAN DEFAULT FALSE,
    UNIQUE(user_id),
    UNIQUE(position)
  );
  CREATE TABLE IF NOT EXISTS personal_events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    event_date DATE NOT NULL,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_personal_events_user_date ON personal_events(user_id, event_date);
  -- קבצים אישיים — כל קובץ משויך למשתמשת אחת בלבד ולמקצוע
  CREATE TABLE IF NOT EXISTS personal_files (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(120) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    drive_file_id VARCHAR(255) NOT NULL,
    drive_folder_id VARCHAR(255),
    mime_type VARCHAR(150),
    size_bytes BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_personal_files_user ON personal_files(user_id, created_at DESC);
  -- דיווחי תקלות ובקשות פיצ'רים
  CREATE TABLE IF NOT EXISTS feedback_reports (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(30) NOT NULL DEFAULT 'other',
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  -- קבצים מרובים למטלה ולמודעה
  CREATE TABLE IF NOT EXISTS assignment_files (
    id SERIAL PRIMARY KEY,
    assignment_id INT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    drive_file_id VARCHAR(255) NOT NULL,
    drive_web_view_link TEXT,
    mime_type VARCHAR(150),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_assignment_files_assignment ON assignment_files(assignment_id);
  CREATE TABLE IF NOT EXISTS notice_files (
    id SERIAL PRIMARY KEY,
    notice_id INT NOT NULL REFERENCES notice_board(id) ON DELETE CASCADE,
    original_name VARCHAR(255) NOT NULL,
    drive_file_id VARCHAR(255) NOT NULL,
    drive_web_view_link TEXT,
    mime_type VARCHAR(150),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_notice_files_notice ON notice_files(notice_id);
  -- סימון 11 התלמידות הפעילות (היתר — מורה/אורחות — נשארות מסומנות FALSE)
  UPDATE users SET is_student = TRUE WHERE id IN (8, 12, 14, 13, 15, 16, 11, 20, 9, 17, 10);
`).catch(err => console.error('שגיאה בעדכון עמודות קבצי המטלות:', err));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});