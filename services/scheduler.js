const cron = require('node-cron');
const pool = require('../db');
const { sendHomeworkDigest } = require('./emailService');

function initScheduler() {
  cron.schedule('0 * * * *', async () => {
    const currentHour = new Date().getHours();

    try {
      const usersResult = await pool.query(
        `SELECT id, full_name, email 
         FROM users 
         WHERE email_notifications = TRUE 
           AND date_part('hour', notification_time) = $1`,
        [currentHour]
      );

      if (usersResult.rows.length === 0) return;

      const assignmentsResult = await pool.query(
        `SELECT * FROM assignments WHERE due_date >= CURRENT_DATE ORDER BY due_date ASC`
      );

      if (assignmentsResult.rows.length === 0) return;

      for (const user of usersResult.rows) {
        await sendHomeworkDigest(user.email, user.full_name, assignmentsResult.rows);
      }
    } catch (err) {
      console.error('שגיאה בהרצת מתזמן המיילים:', err);
    }
  });
}

module.exports = initScheduler;