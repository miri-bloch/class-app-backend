const express = require('express');
const router = express.Router();
const pool = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');

// נורמליזציה להשוואת שמות אירועים (התעלמות מרווחים עודפים ורגישות רישיות)
function normalizeTitle(title) {
  return String(title || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// כמות כל מי שאישרו/הצטרפו לאירוע = 1 (היוצרת) + מספר ההצטרפויות הייחודיות
async function getConfirmCount(eventId) {
  const res = await pool.query(
    `SELECT confirm_count FROM shared_events WHERE id = $1`,
    [eventId]
  );
  return res.rows[0]?.confirm_count ?? 1;
}

// קבלת כל האירועים המשותפים
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, event_date, created_by_name, confirm_count
      FROM shared_events
      ORDER BY event_date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת האירועים' });
  }
});

// הוספת אירוע משותף חדש, עם מניעת כפילויות חכמה
router.post('/', optionalAuth, async (req, res) => {
  const { title, event_date } = req.body;

  if (!title || !event_date) {
    return res.status(400).json({ error: 'כותרת ותאריך הם שדות חובה' });
  }

  // זהות סמכותית: מהטוקן אם קיים, אחרת (לגאסי) מה-body
  const userId = req.user?.id ?? req.body.userId ?? null;
  const userName = req.user?.full_name ?? req.body.userName ?? 'משתמשת';

  try {
    // חיפוש אירוע קיים באותו תאריך עם כותרת דומה (כדי למנוע כפילויות)
    const existing = await pool.query(`
      SELECT * FROM shared_events
      WHERE event_date = $1
    `, [event_date]);

    const normTitle = normalizeTitle(title);
    const duplicate = existing.rows.find(ev => normalizeTitle(ev.title) === normTitle);

    // אם כבר קיים אירוע זהה באותו תאריך — נחזיר 409 כדי שה-frontend יוכל להציע "להצטרף" במקום כפילות
    if (duplicate) {
      return res.status(409).json({
        code: 'DUPLICATE',
        error: 'אירוע דומה כבר קיים בתאריך הזה',
        existingEvent: {
          id: duplicate.id,
          title: duplicate.title,
          event_date: duplicate.event_date,
          created_by_name: duplicate.created_by_name,
          confirm_count: duplicate.confirm_count
        }
      });
    }

    const result = await pool.query(
      `INSERT INTO shared_events (title, event_date, user_id, created_by_name, confirm_count)
       VALUES ($1, $2, $3, $4, 1)
       RETURNING *`,
      [title, event_date, userId || null, userName || 'משתמשת']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהוספת האירוע' });
  }
});

// הצטרפות / אישור לאירוע קיים (עליית "הצטרפות" במקום הוספת כפילות)
router.post('/:id/confirm', optionalAuth, async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user?.id ?? (req.body.userId || null);

  try {
    const ev = await pool.query(
      `SELECT id, user_id, confirm_count FROM shared_events WHERE id = $1`,
      [eventId]
    );
    if (ev.rows.length === 0) {
      return res.status(404).json({ error: 'האירוע לא נמצא' });
    }
    const event = ev.rows[0];

    // זו היוצרת בעצמה? אין טעם להגדיל את הספירה עליה מחדש
    if (userId && Number(event.user_id) === Number(userId)) {
      return res.json({ id: eventId, confirm_count: event.confirm_count, already: true });
    }

    // הצטרפות ייחודית למשתמשת — מונע ספירה כפולה של אותה בנות
    // הצטרפות חייבת זהות אמיתית (טוקן או userId): ללא זהות אין דרך למנוע כפילות,
    // ולכן איננו רושמים כלל (כל משתמשת מחוברת ממילא).
    if (userId) {
      const join = await pool.query(
        `INSERT INTO event_confirmations (event_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (event_id, user_id) DO NOTHING
         RETURNING event_id`,
        [eventId, userId]
      );

      if (join.rows.length > 0) {
        await pool.query(
          `UPDATE shared_events SET confirm_count = confirm_count + 1 WHERE id = $1`,
          [eventId]
        );
      }
    }

    const count = await getConfirmCount(eventId);
    res.json({ id: eventId, confirm_count: count, already: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהצטרפות לאירוע' });
  }
});

// מחיקת אירוע משותף (משפיעה על כולם — דורש התחברות וה-frontend מבקש אישור)
router.delete('/:id', auth, async (req, res) => {
  const eventId = req.params.id;

  try {
    const result = await pool.query(
      'DELETE FROM shared_events WHERE id = $1 RETURNING *',
      [eventId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'האירוע לא נמצא' });
    }

    res.json({ message: 'האירוע נמחק בהצלחה' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה במחיקת האירוע' });
  }
});

module.exports = router;
