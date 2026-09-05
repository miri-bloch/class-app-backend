const { Pool } = require('pg');
require('dotenv').config();

// הגדרת חיבור ה-Pool עם תמיכת SSL תמיד מול Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('connect', () => {
  console.log('Successfully connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Unexpected database error', err);
});

module.exports = pool;