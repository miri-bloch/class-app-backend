const express = require('express');
const router = express.Router();
const pool = require('../db');
const { sendBrandedEmail } = require('../services/emailService');
const { auth, optionalAuth } = require('../middleware/auth');

// קריאת כל שורות הסיבוב ממוינות לפי הסדר, כולל פרטי המשתמשת.
async function getRotationRows() {
  const res = await pool.query(
    `SELECT mr.id, mr.position, mr.is_current, mr.user_id, u.full_name, u.email
     FROM milk_rotation mr
     JOIN users u ON mr.user_id = u.id
     ORDER BY mr.position ASC`
  );
  return res.rows;
}

// שליחת מייל לבאה בתור — נותר כפי שהיה קיים כדי להמשיך ולהודיע למי שצריכה לקנות.
async function notifyNext(nextUser) {
  const contentHtml = `
    <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">שלום ${nextUser.full_name}, הגיע תורך בתורנות החלב! 🥛</div>
    <div style="font-size: 15px; color: #d1d5db; line-height: 1.6;">התור הקודם הושלם בהצלחה, כעת עליך לדאוג לרכש החלב עבור הכיתה.</div>
  `;
  await sendBrandedEmail(nextUser.email, '🥛 תורן חלב - הגיע תורך!', 'MILK DUTY NOTIFICATION', contentHtml);
}

// שליפת מצב התור — מי הנוכחית, מי הבאות, ואיזו משתמשת היא המחוברת.
router.get('/', optionalAuth, async (req, res) => {
  try {
    const rows = await getRotationRows();

    if (rows.length === 0) {
      return res.json({ current: null, upcoming: [], rotation: [], is_mine: false });
    }

    const current = rows.find(r => r.is_current) || rows[0];
    const currentPos = current.position;

    // הבאות: כל מי שבא אחרי הנוכחית, וכשמגיעים לסוף — גלגול חזרה לראש.
    const after = rows.filter(r => r.position > currentPos);
    const before = rows.filter(r => r.position < currentPos);
    const upcoming = [...after, ...before].slice(0, 3);

    const myId = req.user?.id ?? null;
    const is_mine = myId != null && Number(current.user_id) === Number(myId);

    res.json({ current, upcoming, rotation: rows, is_mine });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת תורנויות החלב' });
  }
});

// המנהלת שומרת את סדר התור (רשימת מזהה משתמשות לפי הסדר הרצוי).
router.post('/rotation', auth, async (req, res) => {
  let userIds = req.body.userIds;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'יש לשלוח רשימת משתמשות בסדר התור' });
  }
  // וידוא שהערכים הם מספרים חיוביים בלבד.
  const sanitized = [...new Set(userIds.map(Number))].filter(n => Number.isInteger(n) && n > 0);
  if (sanitized.length === 0) {
    return res.status(400).json({ error: 'רשימת המשתמשות אינה תקינה' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM milk_rotation');
    const insert = 'INSERT INTO milk_rotation (user_id, position, is_current) VALUES ($1, $2, $3)';
    for (let i = 0; i < sanitized.length; i++) {
      await client.query(insert, [sanitized[i], i + 1, i === 0]);
    }
    await client.query('COMMIT');
    res.json({ message: 'סדר התור נשמר בהצלחה' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשמירת סדר התור' });
  } finally {
    client.release();
  }
});

// מעבר אוטומטי לתורנית הבאה בסיבוב (+ מייל לבאה), או גלגול חזרה לראש.
router.patch('/advance', auth, async (req, res) => {
  try {
    const rows = await getRotationRows();
    if (rows.length === 0) {
      return res.status(400).json({ error: 'כרגע אין סדר תור מוגדר' });
    }

    const current = rows.find(r => r.is_current) || rows[0];
    const currentPos = current.position;
    rows.sort((a, b) => a.position - b.position);

    // הבאה: ה-position הבא אחרי הנוכחית, או חזרה לראש כשמגיעים לסוף.
    let next = rows.find(r => r.position > currentPos);
    if (!next) next = rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE milk_rotation SET is_current = FALSE');
      await client.query('UPDATE milk_rotation SET is_current = TRUE WHERE user_id = $1', [next.user_id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // שליחת מייל לבאה — הלוגיקה נשמרה כפי שהייתה קיימת.
    try {
      await notifyNext(next);
    } catch (mailErr) {
      console.error('שגיאה בשליחת מייל לתורנית הבאה:', mailErr);
    }

    res.json({ current: next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בקידום התור' });
  }
});

module.exports = router;
