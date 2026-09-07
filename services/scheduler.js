// ספריית תזמון, חיבור למסד ושירות שליחת ריכוז המטלות.
const cron = require('node-cron');
const pool = require('../db');
const { sendHomeworkDigest } = require('./emailService');

// מפעיל משימה יומית ששולחת מטלות של המחר בשעה 20:00.
function initScheduler() {
  cron.schedule('0 20 * * *', async () => {
    try {
      const usersResult = await pool.query(
        `SELECT id, full_name, email
         FROM users 
         WHERE email_notifications = TRUE`
      );

      if (usersResult.rows.length === 0) return;

      for (const user of usersResult.rows) {
        const userAssignments = await pool.query(
          `SELECT a.*
           FROM assignments a
           WHERE a.due_date = CURRENT_DATE + 1
             AND NOT EXISTS (
               SELECT 1
               FROM private_notes pn
               WHERE pn.assignment_id = a.id
                 AND pn.user_id = $1
                 AND pn.is_completed = TRUE
             )
           ORDER BY a.due_date ASC`,
          [user.id]
        );

        if (userAssignments.rows.length > 0) {
          await sendHomeworkDigest(user.email, user.full_name, userAssignments.rows);
        }
      }
    } catch (err) {
      console.error('שגיאה בהרצת מתזמן המיילים:', err);
    }
  }, { timezone: 'Asia/Jerusalem' });
}

// מייצא את פונקציית אתחול המתזמן ל-server.js.
module.exports = initScheduler;