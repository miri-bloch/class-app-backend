// סקריפט שחזור גיבוי — יוצר את כל הטבלאות ומחדיר את כל הנתונים למסד חדש (למשל Neon).
// שימוש:  node database/restore-backup.js "postgresql://..."
// אם לא מעבירים URL, נלקח מ-DATABASE_URL שבקובץ .env.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

const BACKUP_FILE = path.join(__dirname, '..', 'database-backup-full.json');

// סכמת הטבלאות (תואמת בדיוק למבנה המקורי של הפרויקט)
const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_notifications BOOLEAN DEFAULT TRUE,
  notification_time TIME DEFAULT '20:00',
  is_student BOOLEAN DEFAULT FALSE,
  last_seen TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  subject VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  due_date DATE NOT NULL,
  difficulty_level INT CHECK (difficulty_level BETWEEN 1 AND 5),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  drive_file_id VARCHAR(255),
  drive_web_view_link TEXT,
  attachment_name VARCHAR(255)
);

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

CREATE TABLE IF NOT EXISTS shared_events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  event_date DATE NOT NULL,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  created_by_name VARCHAR(100) DEFAULT 'משתמשת',
  confirm_count INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_confirmations (
  event_id INT REFERENCES shared_events(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS personal_events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  event_date DATE NOT NULL,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_personal_events_user_date ON personal_events(user_id, event_date);
`;

async function main() {
  const targetUrl = process.argv[2] || process.env.DATABASE_URL;
  if (!targetUrl) {
    console.error('לא נמצאה כתובת מסד. העבר URL כארגומנט או הגדר DATABASE_URL.');
    process.exit(1);
  }

  if (!fs.existsSync(BACKUP_FILE)) {
    console.error('לא נמצא קובץ גיבוי:', BACKUP_FILE);
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  const pool = new Pool({ connectionString: targetUrl, ssl: { rejectUnauthorized: false } });

  try {
    console.log('מחבר למסד היעד...');
    await pool.query('SELECT 1');

    console.log('יוצר טבלאות...');
    await pool.query(schemaSql);

    // מחדיר את כל הנתונים לפי סדר שהמפתחות הזרים מאפשרים
    const order = ['users', 'assignments', 'private_notes', 'milk_duty', 'milk_rotation', 'notice_board', 'summaries', 'shared_events', 'event_confirmations', 'personal_events'];

    for (const table of order) {
      const rows = backup.tables[table] || [];
      if (rows.length === 0) {
        console.log(`- ${table}: אין שורות לדלג`);
        continue;
      }
      const cols = Object.keys(rows[0]);
      const colList = cols.join(', ');
      for (const row of rows) {
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const values = cols.map(c => row[c]);
        // null ב-JSON הפך ל-null תקין; התאריכים בתבנית כולם תקינים.
        await pool.query(
          `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values
        );
      }
      console.log(`- ${table}: ${rows.length} שורות יובאו`);
    }

    console.log('\n✅ השחזור הושלם בהצלחה!');
  } catch (err) {
    console.error('שגיאה בשחזור:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
