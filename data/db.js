// Pool מנהל את חיבורי PostgreSQL ומאפשר שימוש חוזר בהם.
const { Pool } = require('pg');
require('dotenv').config();

// הגדרות החיבור למסד הנתונים מתוך משתני הסביבה.
//
// max ו-idleTimeoutMillis מגבילים את מספר החיבורים הפתוחים ל-Postgres.
// ברירת המחדל של pg היא 10 חיבורים שנשארים פתוחים, וכל חיבור כזה מחזיק
// זיכרון גם אצלנו וגם אצל ספק המסד (Neon). השרת שלנו קטן, ולכן 5 מספיק
// בהחלט, וחיבור שלא בשימוש נסגר אחרי חצי דקה במקום להישאר תלוי.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
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