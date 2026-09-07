// Pool מנהל את חיבורי PostgreSQL ומאפשר שימוש חוזר בהם.
const { Pool } = require('pg');
require('dotenv').config();

// הגדרות החיבור למסד הנתונים מתוך משתני הסביבה.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// מודיע כאשר נוצר חיבור חדש למסד הנתונים.
pool.on('connect', () => {
  console.log('Successfully connected to PostgreSQL');
});

// מטפל בשגיאות כלליות של Pool החיבורים.
pool.on('error', (err) => {
  console.error('Unexpected database error', err);
});

// מייצא את החיבור לשימוש בשכבות הנתונים והבקרים.
module.exports = pool;