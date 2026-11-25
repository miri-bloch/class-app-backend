// ליבת מבצע השינה המוקדמת.
//
// הרעיון המרכזי: כל ערוץ דיווח (אתר, טופס אורח, קו טלפון, מנהלת) עובר דרך
// markBedtime() אחת. שכבת הנתונים לא יודעת ולא צריכה לדעת מאיפה הגיע הסימון —
// כך אפשר להחליף את הערוץ הראשי בעתיד בלי לגעת בסטטיסטיקות ובמיילים.
//
// "לילה לוגי": מי שמסמנת 00:30 בלילה שייכת ללילה שלפני. כל שעה לפני שעת
// ה-ROLLOVER (ברירת מחדל 04:00) נחשבת ללילה הקודם, כדי שדיווח מאוחר לא יפתח
// יום חדש עם "שעת שינה" של 00:30 שנראית כאילו נרדמה מוקדם.

const pool = require('../data/db');

const TIME_ZONE = 'Asia/Jerusalem';
const ROLLOVER_HOUR = Number(process.env.SLEEP_ROLLOVER_HOUR || 4);
const EARLIEST_MINUTES = 16 * 60; // 16:00 — לפני זה כמעט בוודאי טעות
const LATEST_MINUTES = ROLLOVER_HOUR * 60; // עד 04:00 נחשב ללילה הקודם

// ---------- עזרי זמן ----------

// מחזיר את חלקי התאריך והשעה הנוכחיים לפי שעון ישראל,
// בלי להסתמך על אזור הזמן של השרת (Render רץ ב-UTC).
function toLocalParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

// ממיר "22:30" / "2230" למספר דקות מחצות. מחזיר null אם אינו שעה חוקית.
function bedtimeToMinutes(value) {
  if (value === null || value === undefined) return null;
  let hh;
  let mm;
  const text = String(value).trim();
  const colonMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  const digitsMatch = text.match(/^(\d{2})(\d{2})$/);
  if (colonMatch) {
    hh = Number(colonMatch[1]);
    mm = Number(colonMatch[2]);
  } else if (digitsMatch) {
    hh = Number(digitsMatch[1]);
    mm = Number(digitsMatch[2]);
  } else {
    return null;
  }
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTime(minutes) {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// שעת שינה "מנורמלת" להשוואה: 00:30 הופך ל-1470 כדי שגם דיווח אחרי חצות
// ייחשב מאוחר יותר מ-22:30.
function comparableMinutes(minutes) {
  return minutes < EARLIEST_MINUTES ? minutes + 24 * 60 : minutes;
}

// התאריך של הלילה הלוגי: YYYY-MM-DD.
function logicalSleepDate(date = new Date()) {
  const p = toLocalParts(date);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (p.hour < ROLLOVER_HOUR) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------- ולידציה ----------

// מחזיר { ok, bedtime, minutes } או { ok:false, error }.
function validateReport(rawBedtime) {
  const minutes = bedtimeToMinutes(rawBedtime);
  if (minutes === null) {
    return { ok: false, error: 'שעת השינה אינה בפורמט תקין (למשל 22:30)' };
  }
  if (minutes < EARLIEST_MINUTES && minutes >= LATEST_MINUTES) {
    return { ok: false, error: 'נראה שזו שעת בוקר — יש להזין שעת שינה של הערב או הלילה' };
  }
  return { ok: true, bedtime: minutesToTime(minutes), minutes };
}

function resolveStatus(bedtimeMinutes, targetMinutes) {
  if (targetMinutes === null || targetMinutes === undefined) return 'on_time';
  return comparableMinutes(bedtimeMinutes) <= comparableMinutes(targetMinutes) ? 'on_time' : 'late';
}

// ---------- כתיבה ----------

// רושם שינה. אם כבר קיים דיווח לאותו לילה — הוא נדרס (הדיווח האחרון קובע),
// אבל מקור 'phone' שנקבע בשיחה לא נדרס בשקט ע"י 'web' באותו לילה, כדי
// שסימון שנעשה בטעות מהמחשב לא ימחק סימון טלפוני אמיתי.
async function markBedtime({ userId, bedtime, source = 'web', note = null, targetMinutes = null, at = new Date() }) {
  const check = validateReport(bedtime);
  if (!check.ok) return { ok: false, error: check.error };

  const sleepDate = logicalSleepDate(at);
  const status = resolveStatus(check.minutes, targetMinutes);

  const result = await pool.query(
    `INSERT INTO sleep_logs (user_id, sleep_date, bedtime, reported_at, updated_at, source, status, note)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4, $5, $6)
     ON CONFLICT (user_id, sleep_date) DO UPDATE
       SET bedtime = EXCLUDED.bedtime,
           reported_at = CASE
             WHEN sleep_logs.source = 'phone' AND EXCLUDED.source IN ('web','guest')
               THEN sleep_logs.reported_at
             ELSE EXCLUDED.reported_at
           END,
           updated_at = CURRENT_TIMESTAMP,
           source = CASE
             WHEN sleep_logs.source = 'phone' AND EXCLUDED.source IN ('web','guest')
               THEN sleep_logs.source
             ELSE EXCLUDED.source
           END,
           status = EXCLUDED.status,
           note = COALESCE(EXCLUDED.note, sleep_logs.note)
     RETURNING id, sleep_date, to_char(bedtime, 'HH24:MI') AS bedtime, source, status, reported_at`,
    [userId, sleepDate, check.bedtime, source, status, typeof note === 'string' ? note.slice(0, 300) : null]
  );
  return { ok: true, log: result.rows[0], sleepDate };
}

// ---------- קריאה ----------

async function getUserSettings(userId) {
  const result = await pool.query(
    `SELECT id, full_name, phone_number, sleep_opt_in, sleep_guest_token,
            to_char(sleep_target_time, 'HH24:MI') AS sleep_target_time
       FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getUserByPhone(phone) {
  if (!phone) return null;
  const normalized = String(phone).replace(/[^\d]/g, '');
  const tail = normalized.slice(-9); // התאמה לפי 9 הספרות האחרונות (מתעלמת מקידומת 0/972)
  if (tail.length < 9) return null;
  const result = await pool.query(
    `SELECT id, full_name, phone_number, sleep_opt_in,
            to_char(sleep_target_time, 'HH24:MI') AS sleep_target_time
       FROM users
      WHERE regexp_replace(phone_number, '\\D', '', 'g') LIKE '%' || $1
      LIMIT 1`,
    [tail]
  );
  return result.rows[0] || null;
}

// סדרת הרצף: כמה לילות רצופים (עד אתמול/היום) בדיווח שהוגדר "בזמן".
// לילה בלי דיווח שובר את הרצף; הלילה הנוכחי לא נספר אם טרם דווח.
function computeStreak(rows, today) {
  let streak = 0;
  let cursor = new Date(`${today}T00:00:00Z`);
  const map = new Map(rows.map((r) => [String(r.sleep_date).slice(0, 10), r]));

  // אם הלילה הנוכחי טרם דווח — מתחילים מאתמול, כדי שהרצף לא ייראה כאילו נשבר
  if (!map.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  for (let i = 0; i < 400; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    const row = map.get(key);
    if (!row || row.status !== 'on_time') break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

// סטטיסטיקה אישית: אחרון, ממוצע, רצף, התפלגות שבועית והיסטוריה ל-30 יום.
async function getUserStats(userId, days = 30) {
  const result = await pool.query(
    `SELECT to_char(sleep_date, 'YYYY-MM-DD') AS sleep_date,
            to_char(bedtime, 'HH24:MI') AS bedtime,
            status, source, reported_at
       FROM sleep_logs
      WHERE user_id = $1
        AND sleep_date >= CURRENT_DATE - $2::int
      ORDER BY sleep_date ASC`,
    [userId, days]
  );
  const rows = result.rows;
  const today = logicalSleepDate();

  const toMin = (t) => bedtimeToMinutes(t);
  const onTimeRows = rows.filter((r) => r.status === 'on_time');
  const avgMinutes = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + comparableMinutes(toMin(r.bedtime)), 0) / rows.length)
    : null;

  // ממוצע 7 הימים האחרונים מול 7 הימים שלפניהם — "משתפרת?"
  const sorted = rows.slice().sort((a, b) => a.sleep_date.localeCompare(b.sleep_date));
  const last7 = sorted.slice(-7);
  const prev7 = sorted.slice(-14, -7);
  const avgOf = (arr) =>
    arr.length ? arr.reduce((s, r) => s + comparableMinutes(toMin(r.bedtime)), 0) / arr.length : null;
  const avgLast7 = avgOf(last7);
  const avgPrev7 = avgOf(prev7);
  const improvement = avgLast7 !== null && avgPrev7 !== null ? Math.round(avgPrev7 - avgLast7) : null;

  return {
    today,
    streak: computeStreak(rows, today),
    totalNights: rows.length,
    onTimeNights: onTimeRows.length,
    onTimeRate: rows.length ? Math.round((onTimeRows.length / rows.length) * 100) : 0,
    lastNight: rows.length ? rows[rows.length - 1] : null,
    tonight: rows.find((r) => r.sleep_date === today) || null,
    averageBedtime: avgMinutes !== null ? minutesToTime(((avgMinutes % 1440) + 1440) % 1440) : null,
    avgLast7Minutes: avgLast7 !== null ? Math.round(avgLast7) : null,
    avgPrev7Minutes: avgPrev7 !== null ? Math.round(avgPrev7) : null,
    improvementMinutes: improvement,
    history: rows,
  };
}

// סקירה כיתתית ללילה מסוים (ברירת מחדל: אתמול — כדי שלא לחשוף מי טרם דיווחה).
async function getOverview(sleepDate = null) {
  const date = sleepDate || (() => {
    const d = new Date(`${logicalSleepDate()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const result = await pool.query(
    `SELECT u.id, u.full_name,
            to_char(l.bedtime, 'HH24:MI') AS bedtime,
            l.status, l.source
       FROM users u
       LEFT JOIN sleep_logs l ON l.user_id = u.id AND l.sleep_date = $1
      WHERE u.is_student = TRUE AND COALESCE(u.sleep_opt_in, TRUE) = TRUE
      ORDER BY l.bedtime ASC NULLS LAST, u.full_name ASC`,
    [date]
  );

  const reported = result.rows.filter((r) => r.bedtime);
  return {
    sleepDate: date,
    earliest: reported[0] ? { name: reported[0].full_name, bedtime: reported[0].bedtime } : null,
    reportedCount: reported.length,
    participants: result.rows.length,
    onTimeCount: reported.filter((r) => r.status === 'on_time').length,
    participantsList: result.rows,
  };
}

// ---------- קו טלפון ----------

// טוקן חד-פעמי-למשתמש לטופס אורח (קישור אישי, לא טוקן התחברות).
function generateGuestToken() {
  const crypto = require('crypto');
  return crypto.randomBytes(24).toString('hex');
}

async function getOrCreateGuestToken(userId) {
  const existing = await pool.query('SELECT sleep_guest_token FROM users WHERE id = $1', [userId]);
  if (existing.rows[0]?.sleep_guest_token) return existing.rows[0].sleep_guest_token;
  const token = generateGuestToken();
  const updated = await pool.query(
    `UPDATE users SET sleep_guest_token = $2 WHERE id = $1 RETURNING sleep_guest_token`,
    [userId, token]
  );
  return updated.rows[0].sleep_guest_token;
}

async function getUserByGuestToken(token) {
  if (!token || !/^[a-f0-9]{32,64}$/i.test(token)) return null;
  const result = await pool.query(
    `SELECT id, full_name, sleep_opt_in, to_char(sleep_target_time, 'HH24:MI') AS sleep_target_time
       FROM users WHERE sleep_guest_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

module.exports = {
  TIME_ZONE,
  toLocalParts,
  bedtimeToMinutes,
  minutesToTime,
  comparableMinutes,
  logicalSleepDate,
  validateReport,
  resolveStatus,
  markBedtime,
  getUserSettings,
  getUserByPhone,
  getUserStats,
  getOverview,
  computeStreak,
  getOrCreateGuestToken,
  getUserByGuestToken,
};
