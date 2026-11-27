const cron = require('node-cron');
const pool = require('../db');
const { sendHomeworkDigest, sendSleepWeeklyEmail } = require('./emailService');
const sleepService = require('./sleepService');

// קצב בדיקת המיילים. קבוע כדי שיהיה ברור שהחלון בשאילתה (15 דקות)
// חייב להתאים לקצב הזה — אחרת או שנפספס שעות, או שנשלח פעמיים.
const EMAIL_TICK = '*/15 * * * *';

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

  // פעם ב-15 דקות ולא כל דקה: כל הרצה פותחת חיבור למסד ומעירה את השרת,
  // ובשביל מייל מטלות אין משמעות לדיוק של דקה. החלון למטה מפצה על כך.
  cron.schedule(EMAIL_TICK, async () => {
    try {
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        weekday: 'long'
      }).format(new Date());
      const examReminder = weekday === 'Sunday'
        ? 'ביום ראשון יש ללמוד לבוחן במערכות הפעלה, שיתקיים מחר.'
        : weekday === 'Monday'
          ? 'ביום שני יש ללמוד לבוחן ב-CORE, שיתקיים מחר.'
          : '';

      // חלון של 15 דקות אחורה במקום השוואה מדויקת לשעה:00.
      // כולם קובעים שעה עגולה (17:00, 20:00), ואם נשווה דקה בדיוק — כל
      // דקה שההרצה מפספסת (השרת עסוק, הרצה נכשלת) גורמת למייל לא להישלח
      // בכלל, בלי שמישהי תדע. החלון מבטיח שכל שעה שנקבעה נקלטת בסיבוב
      // הקרוב, ובדיוק פעם אחת כי השעה יוצאת מהחלון מיד אחר כך.
      const usersResult = await pool.query(
        `SELECT id, full_name, email
         FROM users
         WHERE email_notifications = TRUE
           AND notification_time >  (LOCALTIME AT TIME ZONE 'Asia/Jerusalem') - INTERVAL '15 minutes'
           AND notification_time <= (LOCALTIME AT TIME ZONE 'Asia/Jerusalem')`
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

  // ===== מבצע השינה המוקדמת =====
  //
  // אין מייל יומי: הדיווח היחיד הוא בקו הטלפון והמקום האישי מוצג באתר בלבד.
  // המייל היחיד הוא סיכום שבועי כיתתי ביום שישי — בלי שמות של בנות.

  // 07:00 ביום שישי — סיכום שבועי אחד לכל משתתפת, עם אותם מספרים לכולן
  cron.schedule('0 7 * * 5', async () => {
    try {
      const summary = await sleepService.getWeeklyClassSummary(7);
      if (!summary.reported) {
        console.log('אין דיווחי שינה בשבוע האחרון — לא נשלח סיכום שבועי');
        return;
      }
      const users = await pool.query(
        `SELECT full_name, email FROM users
          WHERE is_student = TRUE AND COALESCE(sleep_opt_in, TRUE) = TRUE AND email IS NOT NULL`
      );
      for (const user of users.rows) {
        try {
          await sendSleepWeeklyEmail(user.email, {
            name: user.full_name.split(' ')[0],
            reported: summary.reported,
            onTime: summary.onTime,
            totalNights: 7,
            averageBedtime: summary.averageBedtime,
            bestNight: summary.bestNight,
            improvementMinutes: summary.improvementMinutes,
          });
        } catch (err) {
          console.error(`שגיאה בסיכום שינה שבועי ל-${user.email}:`, err.message);
        }
      }
    } catch (err) {
      console.error('שגיאה בסיכום השינה השבועי:', err);
    }
  }, { timezone: 'Asia/Jerusalem' });
}

module.exports = initScheduler;