// טוען משתני סביבה לפני אתחול השירותים.
require('dotenv').config();

// מייבא את אפליקציית Express, חיבור הנתונים ומתזמן ההתראות.
const app = require('./app');
const pool = require('./data/db');
const initScheduler = require('./services/scheduler');

// מפעיל את שליחת ההתראות המתוזמנת.
initScheduler();

// בודק שהשרת מצליח להתחבר למסד הנתונים.
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('שגיאה בהתחברות למסד הנתונים:', err);
  } else {
    console.log('התחברות למסד הנתונים הצליחה! השעה במסד:', result.rows[0].now);
  }
});

// מוסיף עמודות חדשות למסד אם הן עדיין לא קיימות.
pool.query(`
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_time TIME DEFAULT '20:00';
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255);
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT;
  ALTER TABLE assignments ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);
`).catch(err => console.error('שגיאה בעדכון עמודות קבצי המטלות:', err));

// קובע את הפורט של השרת לפי הסביבה או משתמש ב-3000 כברירת מחדל.
const PORT = process.env.PORT || 3000;

// מתחיל להאזין לבקשות HTTP.
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});