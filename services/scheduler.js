const cron = require('node-cron');
const pool = require('../db');
const { sendHomeworkDigest } = require('./emailService');

function initScheduler() {
  cron.schedule('5 0 * * *', async () => {
    try {
      await pool.query(`
        DELETE FROM assignments a
        WHERE a.due_date <= CURRENT_DATE - 2
          AND EXISTS (SELECT 1 FROM users WHERE is_student = TRUE)
          AND NOT EXISTS (
            SELECT 1
            FROM users u
            LEFT JOIN private_notes pn
              ON pn.user_id = u.id
             AND pn.assignment_id = a.id
            WHERE u.is_student = TRUE
              AND COALESCE(pn.is_completed, FALSE) = FALSE
          )
      `);
      console.log('מטלות שהושלמו ועברו יומיים ממועד הגשתן נמחקו בהצלחה');
    } catch (err) {
      console.error('שגיאה במחיקת מטלות שפג תוקפן:', err);
    }
  }, { timezone: 'Asia/Jerusalem' });

  cron.schedule('* * * * *', async () => {
    try {
      const timeParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).formatToParts(new Date());
      const currentTime = `${timeParts.find(part => part.type === 'hour').value}:${timeParts.find(part => part.type === 'minute').value}`;
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        weekday: 'long'
      }).format(new Date());
      const examReminder = weekday === 'Sunday'
        ? 'ביום ראשון יש ללמוד לבוחן במערכות הפעלה, שיתקיים מחר.'
        : weekday === 'Monday'
          ? 'ביום שני יש ללמוד לבוחן ב-CORE, שיתקיים מחר.'
          : '';
      const usersResult = await pool.query(
        `SELECT id, full_name, email
         FROM users 
         WHERE email_notifications = TRUE
           AND to_char(notification_time, 'HH24:MI') = $1`,
        [currentTime]
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

        if (userAssignments.rows.length > 0 || examReminder) {
          await sendHomeworkDigest(user.email, user.full_name, userAssignments.rows, examReminder);
        }
      }
    } catch (err) {
      console.error('שגיאה בהרצת מתזמן המיילים:', err);
    }
  }, { timezone: 'Asia/Jerusalem' });
}

module.exports = initScheduler;