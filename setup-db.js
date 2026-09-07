const pool = require('./db');

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
`;

async function setup() {
  try {
    await pool.query(schemaSql);
    console.log(' כל הטבלאות נוצרו בהצלחה במסד הנתונים!');
  } catch (err) {
    console.error('שגיאה ביצירת הטבלאות:', err);
  } finally {
    pool.end();
  }
}

setup();