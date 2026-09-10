// חיבור למסד הנתונים המשמש ליצירת הטבלאות.
const pool = require('../data/db');

// סכמת הטבלאות והעמודות הדרושות לכל חלקי המערכת.
const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_notifications BOOLEAN DEFAULT TRUE,
  notification_time TIME DEFAULT '17:00',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_time TIME DEFAULT '20:00';

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  subject VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  due_date DATE NOT NULL,
  difficulty_level INT CHECK (difficulty_level BETWEEN 1 AND 5),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE assignments ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255);
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS drive_web_view_link TEXT;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255);

CREATE TABLE IF NOT EXISTS private_notes (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  assignment_id INT REFERENCES assignments(id) ON DELETE CASCADE,
  note_text TEXT,
  is_completed BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, assignment_id)
);

CREATE TABLE IF NOT EXISTS milk_duty (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  duty_date DATE NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- סדר תורנות החלב שנקבע ע"י המנהלת (סיבוב אוטומטי)
CREATE TABLE IF NOT EXISTS milk_rotation (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INT NOT NULL,
  is_current BOOLEAN DEFAULT FALSE,
  UNIQUE(user_id),
  UNIQUE(position)
);

CREATE TABLE IF NOT EXISTS notice_board (
  id SERIAL PRIMARY KEY,
  author_id INT REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  is_important BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS summaries (
  id SERIAL PRIMARY KEY,
  subject VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  drive_file_id VARCHAR(255) NOT NULL,
  drive_web_view_link TEXT NOT NULL,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- אירועים משותפים בלוח השנה — מופיעים לכולם, לא אישיים
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

-- הצטרפויות ייחודיות לאירוע — מונעות ספירה כפולה של אותה בנות
CREATE TABLE IF NOT EXISTS event_confirmations (
  event_id INT REFERENCES shared_events(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);
`;

// מריץ את סכמת מסד הנתונים ומסיים את החיבור לאחר מכן.
async function setup() {
  try {
    await pool.query(schemaSql);
    console.log('כל הטבלאות נוצרו בהצלחה במסד הנתונים!');
  } catch (err) {
    console.error('שגיאה ביצירת הטבלאות:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// מפעיל את תהליך אתחול מסד הנתונים כשמריצים את הקובץ.
setup();