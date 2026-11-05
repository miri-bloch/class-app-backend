// סקריפט חד-פעמי: מאחד שתי רשומות משתמשת לרשומה אחת.
// שימוש:   node database/merge-user-account.js <מזהה-מקור> <מזהה-יעד>          (הרצת בדיקה בלבד)
//          node database/merge-user-account.js <מזהה-מקור> <מזהה-יעד> --apply  (ביצוע בפועל)
//
// מה נשמר ומה עובר:
//   • היעד שומר על הסיסמה, הבית המייל וההרשאות שלו.
//   • private_notes של המקור עוברות ליעד. כשקיימת כבר רשומה ליעד על אותה מטלה —
//     נשמר המצב ה"חזק" ביותר: בוצע / מוסתר / הוסר / הערה — כדי לא לאבד שום סימון.
//   • last_seen, email_notifications — נשמרים מהיעד, אלא אם היעד ריק.
//   • רשומת המקור נמחקת בסוף (מתבצע רק עם --apply).
//   • לפני השינוי נכתב גיבוי JSON לתיקיית database/backups/.

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const [sourceArg, targetArg] = process.argv.slice(2);
const APPLY = process.argv.includes('--apply');
const SOURCE_ID = Number(sourceArg);
const TARGET_ID = Number(targetArg);

if (!Number.isInteger(SOURCE_ID) || !Number.isInteger(TARGET_ID) || SOURCE_ID === TARGET_ID) {
  console.error('שימוש: node database/merge-user-account.js <מזהה-מקור> <מזהה-יעד> [--apply]');
  process.exit(1);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const users = await client.query(
      'SELECT id, full_name, email, is_student, email_notifications, notification_time, last_seen, created_at FROM users WHERE id = ANY($1::int[]) ORDER BY id',
      [[SOURCE_ID, TARGET_ID]]
    );
    if (users.rows.length !== 2) {
      throw new Error('אחת מהמשתמשות לא נמצאה — אין שינוי.');
    }
    const source = users.rows.find(r => r.id === SOURCE_ID);
    const target = users.rows.find(r => r.id === TARGET_ID);

    // גיבוי לפני כל שינוי — גם בהרצת בדיקה, כדי שההשוואה תהיה מלאה
    const notes = await client.query('SELECT * FROM private_notes WHERE user_id = ANY($1::int[])', [[SOURCE_ID, TARGET_ID]]);
    const backupsDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupsDir, `merge-${SOURCE_ID}-into-${TARGET_ID}-${stamp}.json`);
    fs.writeFileSync(backupFile, JSON.stringify({ users: users.rows, private_notes: notes.rows }, null, 2), 'utf8');

    console.log(`מקור: מזהה ${source.id}, ${source.full_name} — תלמידה: ${source.is_student}`);
    console.log(`יעד:  מזהה ${target.id}, ${target.full_name} — תלמידה: ${target.is_student}`);
    console.log(`גיבוי נשמר: ${backupFile}`);

    // העברת ההערות: UPSERT עם מיזוג מצבים
    const moved = await client.query(
      `INSERT INTO private_notes
         (user_id, assignment_id, note_text, is_completed, is_hidden, is_dismissed, completed_at, vanished_at, hide_until, updated_at)
       SELECT $2, assignment_id, note_text, is_completed, is_hidden, is_dismissed, completed_at, vanished_at, hide_until, updated_at
         FROM private_notes WHERE user_id = $1
       ON CONFLICT (user_id, assignment_id) DO UPDATE SET
         note_text    = COALESCE(private_notes.note_text, EXCLUDED.note_text),
         is_completed = private_notes.is_completed OR EXCLUDED.is_completed,
         is_hidden    = private_notes.is_hidden    OR EXCLUDED.is_hidden,
         is_dismissed = private_notes.is_dismissed OR EXCLUDED.is_dismissed,
         completed_at = COALESCE(private_notes.completed_at, EXCLUDED.completed_at),
         vanished_at  = COALESCE(private_notes.vanished_at,  EXCLUDED.vanished_at),
         hide_until   = COALESCE(private_notes.hide_until,   EXCLUDED.hide_until),
         updated_at   = GREATEST(private_notes.updated_at, EXCLUDED.updated_at)
       RETURNING assignment_id`,
      [SOURCE_ID, TARGET_ID]
    );
    console.log(`הועברו/מוזגו ${moved.rowCount} רשומות private_notes ליעד.`);

    if (source.is_student && !target.is_student) {
      await client.query('UPDATE users SET is_student = TRUE WHERE id = $1', [TARGET_ID]);
      console.log('היעד סומן כתלמידה, כי המקור היה מסומן כך.');
    }
    if (!target.last_seen && source.last_seen) {
      await client.query('UPDATE users SET last_seen = $1 WHERE id = $2', [source.last_seen, TARGET_ID]);
    }

    await client.query('DELETE FROM private_notes WHERE user_id = $1', [SOURCE_ID]);
    await client.query('DELETE FROM users WHERE id = $1', [SOURCE_ID]);
    console.log(`רשומת המקור (מזהה ${SOURCE_ID}) נמחקה.`);

    if (APPLY) {
      await client.query('COMMIT');
      console.log('האיחוד בוצע ונשמר.');
    } else {
      await client.query('ROLLBACK');
      console.log('הרצת בדיקה בלבד — לא נשמר שום שינוי. להוספת --apply לביצוע.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('שגיאה באיחוד:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
