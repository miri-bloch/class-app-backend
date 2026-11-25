// מבצע השינה המוקדמת — API.
//
// שלושה סוגי נגישות:
//  1. משתמשת מחוברת (auth) — הסימון שלה, הסטטיסטיקה שלה, היעד שלה, קישור האורח.
//  2. טופס אורח — ציבורי אך חתום בטוקן אקראי לכל משתמשת (לא טוקן התחברות),
//     עם הגבלת קצב כדי שלא ינוצל לזיוף.
//  3. קו ימות המשיח — POST /api/sleep/yemot. התשובה חייבת להיות טקסט פשוט
//     (לא JSON!), אחרת ימות מחזיר M1607 "אין מענה משרת API".

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const sleepService = require('../services/sleepService');
const pool = require('../data/db');

// ---------- הגבלת קצב פשוטה בזיכרון (בלי תלות חיצונית) ----------
// מספיק לשרת אחד; אם יהיו כמה מופעים — להחליף בטבלה או ב-Redis.
const buckets = new Map();
function rateLimit({ windowMs, max, key }) {
  return (req, res, next) => {
    const id = key(req);
    if (!id) return next();
    const now = Date.now();
    const entry = buckets.get(id);
    if (!entry || now - entry.start > windowMs) {
      buckets.set(id, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'יותר מדי ניסיונות, נסי שוב בעוד מספר דקות' });
    }
    next();
  };
}
// ניקוי תקופתי כדי שהמפה לא תגדל בלי גבול
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of buckets) {
    if (now - entry.start > 60 * 60 * 1000) buckets.delete(id);
  }
}, 10 * 60 * 1000).unref();

const clientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

// ---------- משתמשת מחוברת ----------

// כל מה שמסך השינה צריך בקריאה אחת
router.get('/me', auth, async (req, res) => {
  try {
    const settings = await sleepService.getUserSettings(req.user.id);
    if (!settings) return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    const stats = await sleepService.getUserStats(req.user.id, 30);
    res.json({
      settings: {
        full_name: settings.full_name,
        phone_number: settings.phone_number,
        sleep_opt_in: settings.sleep_opt_in,
        sleep_target_time: settings.sleep_target_time,
      },
      stats,
    });
  } catch (err) {
    console.error('שגיאה בטעינת נתוני השינה:', err);
    res.status(500).json({ error: 'שגיאה בטעינת נתוני השינה' });
  }
});

router.get('/me/stats', auth, async (req, res) => {
  try {
    res.json(await sleepService.getUserStats(req.user.id, 60));
  } catch (err) {
    console.error('שגיאה בסטטיסטיקת שינה:', err);
    res.status(500).json({ error: 'שגיאה בטעינת הסטטיסטיקה' });
  }
});

// סימון מהאתר (חלופה לערוץ הטלפון)
router.post('/me', auth, rateLimit({ windowMs: 60 * 1000, max: 10, key: (req) => `me:${req.user?.id || clientIp(req)}` }), async (req, res) => {
  try {
    const settings = await sleepService.getUserSettings(req.user.id);
    const targetMinutes = settings ? sleepService.bedtimeToMinutes(settings.sleep_target_time) : null;
    const result = await sleepService.markBedtime({
      userId: req.user.id,
      bedtime: req.body?.bedtime,
      source: 'web',
      note: req.body?.note,
      targetMinutes,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ message: 'השינה נרשמה, כל הכבוד!', log: result.log });
  } catch (err) {
    console.error('שגיאה ברישום שינה:', err);
    res.status(500).json({ error: 'שגיאה ברישום השינה' });
  }
});

// עדכון יעד / השתתפות / מספר טלפון
router.patch('/me/settings', auth, async (req, res) => {
  const updates = [];
  const values = [];
  const { sleep_target_time, sleep_opt_in, phone_number } = req.body || {};

  if (sleep_target_time !== undefined) {
    const minutes = sleepService.bedtimeToMinutes(sleep_target_time);
    if (minutes === null) return res.status(400).json({ error: 'שעת היעד אינה תקינה' });
    values.push(sleepService.minutesToTime(minutes));
    updates.push(`sleep_target_time = $${values.length}`);
  }
  if (sleep_opt_in !== undefined) {
    values.push(Boolean(sleep_opt_in));
    updates.push(`sleep_opt_in = $${values.length}`);
  }
  if (phone_number !== undefined) {
    const digits = String(phone_number).replace(/\D/g, '');
    if (digits && !/^0\d{8,9}$|^972\d{8,9}$/.test(digits)) {
      return res.status(400).json({ error: 'מספר הטלפון אינו תקין' });
    }
    values.push(digits || null);
    updates.push(`phone_number = $${values.length}`);
  }
  if (!updates.length) return res.status(400).json({ error: 'לא נשלחו שדות לעדכון' });

  try {
    values.push(req.user.id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    const settings = await sleepService.getUserSettings(req.user.id);
    res.json({
      message: 'ההגדרות נשמרו',
      settings: {
        sleep_target_time: settings.sleep_target_time,
        sleep_opt_in: settings.sleep_opt_in,
        phone_number: settings.phone_number,
      },
    });
  } catch (err) {
    // 23505 = ייחודיות (מספר טלפון שכבר משויך למשתמשת אחרת)
    if (err.code === '23505') return res.status(409).json({ error: 'מספר הטלפון כבר משויך למשתמשת אחרת' });
    console.error('שגיאה בעדכון הגדרות שינה:', err);
    res.status(500).json({ error: 'שגיאה בשמירת ההגדרות' });
  }
});

// קישור הטופס האישי (לטלפון בלי התחברות)
router.get('/me/guest-link', auth, async (req, res) => {
  try {
    const token = await sleepService.getOrCreateGuestToken(req.user.id);
    const base = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base}/sleep.html?t=${token}` });
  } catch (err) {
    console.error('שגיאה ביצירת קישור אורח:', err);
    res.status(500).json({ error: 'שגיאה ביצירת הקישור' });
  }
});

// סקירה כיתתית — כולם רואים מי נרדמה הכי מוקדם אתמול
router.get('/overview', auth, async (req, res) => {
  try {
    res.json(await sleepService.getOverview(req.query.date || null));
  } catch (err) {
    console.error('שגיאה בסקירת השינה:', err);
    res.status(500).json({ error: 'שגיאה בטעינת הסקירה' });
  }
});

// ---------- טופס אורח (קישור אישי) ----------

router.get(
  '/guest/:token',
  rateLimit({ windowMs: 60 * 1000, max: 60, key: clientIp }),
  async (req, res) => {
    try {
      const user = await sleepService.getUserByGuestToken(req.params.token);
      if (!user) return res.status(404).json({ error: 'הקישור אינו תקין' });
      const stats = await sleepService.getUserStats(user.id, 30);
      res.json({
        full_name: user.full_name,
        sleep_target_time: user.sleep_target_time,
        tonight: stats.tonight,
        streak: stats.streak,
        lastNight: stats.lastNight,
      });
    } catch (err) {
      console.error('שגיאה בטופס האורח:', err);
      res.status(500).json({ error: 'שגיאה בטעינת הטופס' });
    }
  }
);

router.post(
  '/guest/:token',
  rateLimit({ windowMs: 60 * 1000, max: 10, key: (req) => `guest:${req.params.token}` }),
  async (req, res) => {
    try {
      const user = await sleepService.getUserByGuestToken(req.params.token);
      if (!user) return res.status(404).json({ error: 'הקישור אינו תקין' });
      const result = await sleepService.markBedtime({
        userId: user.id,
        bedtime: req.body?.bedtime,
        source: 'guest',
        targetMinutes: sleepService.bedtimeToMinutes(user.sleep_target_time),
      });
      if (!result.ok) return res.status(400).json({ error: result.error });
      const stats = await sleepService.getUserStats(user.id, 30);
      res.json({ message: 'נרשם! לילה טוב', log: result.log, streak: stats.streak });
    } catch (err) {
      console.error('שגיאה ברישום שינה מטופס אורח:', err);
      res.status(500).json({ error: 'שגיאה ברישום השינה' });
    }
  }
);

// ---------- קו ימות המשיח ----------
//
// תצורת השלוחה (extension) בימות:
//   type=api
//   api_link=https://<domain>/api/sleep/yemot
//   api_url_post=yes
//   api_000=Time,no,Time,4,4,10,yes,yes
//   api_add_0=<SLEEP_PHONE_SECRET>=<ערך סודי>     (אופציונלי — ראו בדיקת מקור)
//   api_hangup_send=no
//   api_end_goto=/<תיקיית סיום>
//
// הזרימה:
//   1. שיחה נכנסת → ימות משמיעה את 000.wav ומקישה 4 ספרות (השעה, למשל 2230),
//      ואז שולחת לנו שוב, והפעם עם Api_000=<הספרות>.
//   2. אנחנו רושמים את השינה ומחזירים הודעה קולית + מעבר לתיקיית הסיום.
//   3. כל תשובה נשמרת לפי ApiCallId; בקשת retry מקבלת את אותה תשובה בדיוק.
//
// שלב 2 מזוהה לפי Api_000 שקיים ולא ריק — ולכן Api_000_send חייב להישאר דלוק.

const PHONE_SECRET = process.env.SLEEP_PHONE_SECRET || '';
const SLEEP_END_FOLDER = process.env.SLEEP_YEMOT_END_FOLDER || '/5/8';

function yemotText(res, text) {
  res.type('text/plain; charset=utf-8').send(text);
}

// זיהוי מקור: ימות שולחת User-Agent ייחודי. אם הוגדר סוד, גם הוא נדרש.
// לא חוסמים לפי IP — ימות עשויה לשלוח מכמה כתובות.
function isYemotRequest(req) {
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  const hasYemotAgent = ua.includes('yemot');
  const secretOk = !PHONE_SECRET || req.query?.secret === PHONE_SECRET;
  return hasYemotAgent && secretOk;
}

// מבטיח רשומת שיחה קיימת ומחזיר אותה. INSERT ... ON CONFLICT כדי ששתי
// בקשות מקבילות לאותו ApiCallId לא ייכשלו זו על זו.
async function getCallRecord(callId, phone) {
  const inserted = await pool.query(
    `INSERT INTO sleep_phone_calls (call_id, phone) VALUES ($1, $2)
     ON CONFLICT (call_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING call_id, phone, user_id, sleep_date, response, step`,
    [callId, phone || null]
  );
  return inserted.rows[0];
}

async function saveCallResponse(callId, userId, sleepDate, response, step) {
  await pool.query(
    `UPDATE sleep_phone_calls
        SET user_id = COALESCE($2, user_id),
            sleep_date = COALESCE($3, sleep_date),
            response = $4,
            step = $5,
            updated_at = CURRENT_TIMESTAMP
      WHERE call_id = $1`,
    [callId, userId, sleepDate, response, step]
  );
}

async function handleYemot(req, res) {
  const params = req.query || {};

  if (!isYemotRequest(req)) {
    console.warn('בקשת קו שינה נדחתה — מקור לא מזוהה:', req.headers['user-agent'], clientIp(req));
    return res.status(403).type('text/plain; charset=utf-8').send('forbidden');
  }

  const callId = String(params.ApiCallId || '').slice(0, 64);
  const phone = String(params.ApiPhone || '').replace(/\D/g, '').slice(0, 20);
  if (!callId) {
    // בלי מזהה שיחה אין דרך למנוע כפילות — ממשיכים בלי אידמפוטנטיות
    console.warn('בקשת קו שינה ללא ApiCallId');
  }

  try {
    const existing = callId ? await getCallRecord(callId, phone) : null;

    // בקשה חוזרת אחרי שכבר ענינו — אותה תשובה בדיוק (at-least-once)
    if (existing?.response) {
      return yemotText(res, existing.response);
    }

    // שלב 1: אין עדיין ספרות — מבקשים את השעה
    const digits = params.Api_000 !== undefined ? String(params.Api_000).trim() : '';
    if (!digits) {
      // לא אמורים להגיע לכאן כשהשלוחה מוגדרת עם api_000 — ימות משמיעה את
      // 000.wav ומקישה, ושולחת שוב רק בשלב שאחרי ההקשה. כגיבוי: מבקשים שיחה חוזרת.
      const response = `id_list_message=t-לא נקלטו ספרות, נא להתקשר שוב&go_to_folder=${SLEEP_END_FOLDER}`;
      if (callId) await saveCallResponse(callId, null, null, response, 'no_digits');
      return yemotText(res, response);
    }

    const user = await sleepService.getUserByPhone(phone);
    if (!user) {
      const response = `id_list_message=t-המספר הזה אינו רשום במבצע. יש לפנות למזכירות לעדכון המספר.&go_to_folder=${SLEEP_END_FOLDER}`;
      if (callId) await saveCallResponse(callId, null, null, response, 'unknown_phone');
      return yemotText(res, response);
    }

    const result = await sleepService.markBedtime({
      userId: user.id,
      bedtime: digits,
      source: 'phone',
      targetMinutes: sleepService.bedtimeToMinutes(user.sleep_target_time),
    });

    let response;
    if (!result.ok) {
      response = `id_list_message=t-השעה שהוקשה אינה תקינה.&go_to_folder=${SLEEP_END_FOLDER}`;
    } else {
      // הודעה קולית קצרה אחת. טקסט ב-t- חייב להיות בלי נקודה ובלי מקף.
      // פרטי הקריאה (שעה, רצף) מוצגים באתר, לא בשיחה.
      response = `id_list_message=t-נרשם, לילה טוב&go_to_folder=${SLEEP_END_FOLDER}`;
    }

    if (callId) await saveCallResponse(callId, user.id, result.sleepDate || null, response, 'done');
    return yemotText(res, response);
  } catch (err) {
    console.error('שגיאה בקו השינה של ימות:', err);
    // תשובה קצרה ולא זורקת — כדי שהשיחה לא תיקטע בשקט
    return yemotText(res, `id_list_message=t-אירעה תקלה, נסי שוב בעוד רגע&go_to_folder=${SLEEP_END_FOLDER}`);
  }
}

// ימות יכולה לשלוח POST (api_url_post=yes) או GET. שני המסלולים לאותו מטפל.
router.post('/yemot', handleYemot);
router.get('/yemot', handleYemot);

module.exports = router;
