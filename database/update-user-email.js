// סקריפט חד-פעמי: מחליף את כתובת המייל של משתמשת קיימת.
// שימוש:  node database/update-user-email.js
// (אפשר להעביר כתובת חלופית כפרמטרים: "node database/update-user-email.js <מייל-ישן> <מייל-חדש>")
// הסקריפט לא נוגע בסיסמה ולא בנתונים אחרים.

const pool = require('../db');

const OLD_EMAIL = (process.argv[2] || 'm9740628@gmail.com').trim().toLowerCase();
const NEW_EMAIL = (process.argv[3] || 'mr56793061@gmail.com').trim().toLowerCase();

async function main() {
  try {
    // אם הכתובת החדשה כבר שייכת למשתמשת אחרת, הכתובת עצמה ייחודית ולכן
    // עדכון פשוט ייכשל. במקרה כזה מדפיסים הודעה — אין איחוד אוטומטי של
    // משתמשות, כי הוא עלול למחוק היסטוריית ביצועים.
    const clash = await pool.query(
      'SELECT id, full_name FROM users WHERE LOWER(email) = $1',
      [NEW_EMAIL]
    );
    if (clash.rows.length > 0) {
      const old = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [OLD_EMAIL]);
      console.error(
        `הכתובת ${NEW_EMAIL} כבר קיימת במערכת (מזהה ${clash.rows[0].id}).` +
          (old.rows.length > 0
            ? ` גם הכתובת הישנה קיימת (מזהה ${old.rows[0].id}) — יש לאחד את שתי הרשומות ידנית.`
            : ' אין צורך בשינוי.')
      );
      process.exitCode = old.rows.length > 0 ? 1 : 0;
      return;
    }

    const result = await pool.query(
      `UPDATE users
          SET email = $1
        WHERE LOWER(email) = $2
        RETURNING id, email`,
      [NEW_EMAIL, OLD_EMAIL]
    );

    if (result.rows.length === 0) {
      console.log(`לא נמצאה משתמשת עם המייל ${OLD_EMAIL}. לא בוצע שינוי.`);
      return;
    }

    console.log(`עודכנו ${result.rows.length} רשומות:`);
    for (const row of result.rows) {
      console.log(`  מזהה ${row.id} → ${row.email}`);
    }
  } catch (err) {
    console.error('שגיאה בעדכון המייל:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
