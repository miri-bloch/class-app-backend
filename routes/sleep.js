// מבצע השינה המוקדמת — API.
//
// שני סוגי נגישות:
//  1. משתמשת מחוברת (auth) — צפייה בלבד: הסטטיסטיקה שלה, היעד שלה, המקום שלה
//     ביחס לכיתה (בלי שמות של בנות אחרות) והמספר לשיחה.
//  2. קו ימות המשיח — POST /api/sleep/yemot. זה הערוץ היחיד לדיווח שעת שינה.
//     התשובה חייבת להיות טקסט פשוט (לא JSON!), אחרת ימות מחזיר M1607
//     "אין מענה משרת API".
//
// אין יותר דיווח מהאתר ואין טופס אורח: הדיווח מתבצע אך ורק בשיחה.

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const sleepService = require('../services/sleepService');
const pool = require('../data/db');

const clientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

// ---------- משתמשת מחוברת (צפייה בלבד) ----------

// כל מה שמסך השינה צריך בקריאה אחת — לצפייה בלבד, בלי דיווח
router.get('/me', auth, async (req, res) => {
  try {
    const settings = await sleepService.getUserSettings(req.user.id);
    if (!settings) return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    const [stats, night] = await Promise.all([
      sleepService.getUserStats(req.user.id, 30),
      sleepService.getPersonalNight(req.user.id),
    ]);
    res.json({
      settings: {
        full_name: settings.full_name,
        phone_number: settings.phone_number,
        sleep_opt_in: settings.sleep_opt_in,
        sleep_target_time: settings.sleep_target_time,
      },
      stats,
      night,
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

// הלילה של אתמול מנקודת המבט של המשתמשת: השעה שלה, המקום שלה והמספרים הכלליים.
// במכוון אין שמות של בנות אחרות בתשובה.
router.get('/me/night', auth, async (req, res) => {
  try {
    res.json(await sleepService.getPersonalNight(req.user.id, req.query.date || null));
  } catch (err) {
    console.error('שגיאה בטעינת הלילה האישי:', err);
    res.status(500).json({ error: 'שגיאה בטעינת נתוני הלילה' });
  }
});

// עדכון מספר הטלפון. מספר הטלפון נדרש כדי שהקו יזהה את המשתמשת, ולכן הוא
// השדה היחיד שהמשתמשת יכולה למלא בעצמה; היעד וההשתתפות נקבעים על ידי המנהלת.
router.patch('/me/settings', auth, async (req, res) => {
  const updates = [];
  const values = [];
  const { phone_number } = req.body || {};

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

// ---------- קו ימות המשיח ----------
//
// תצורת השלוחה (extension) בימות:
//   type=api
//   api_link=https://<domain>/api/sleep/yemot
//   api_url_post=yes
//   api_000=Time,no,Time,4,4,10,yes,yes
//   api_add_0=secret=<ערך SLEEP_PHONE_SECRET>
//   api_hangup_send=no
//   api_end_goto=/<תיקיית סיום>
//
// הסבר ל-api_000 (הערכים מופרדים בפסיק, לפי סדר):
//   Time  - שם הפרמטר שבו יגיעו הספרות. כלומר ההקשה תגיע כ-ApiTime.
//   no    - לא להשתמש בהקשה קודמת אם קיימת
//   Time  - סוג הנתון: שעה (משמיע "עשרים ושתיים שלושים" לאישור)
//   4,4   - מקסימום ומינימום 4 ספרות (חובה לשעה)
//   10    - המתנה של 10 שניות להקשה
//   yes   - חסימת מקש כוכבית
//   yes   - חסימת האפס הבודד
//   api_add_0 חייב להיות בפורמט <שם>=<ערך> (זה פרמטר לכל בקשה).
//   api_000_send חייב להישאר דלוק כדי שההקשה תגיע אלינו.
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

    // שלב 1: אין עדיין ספרות — מבקשים את השעה.
    // הספרות מגיעות בשם שהוגדר בשדה הראשון של api_000 (בתצורה שלנו: ApiTime).
    // Api_000 נבדק כגיבוי למקרה שהשדה הראשון הושאר ריק — אז ימות שולחת Api_000.
    const rawDigits = params.ApiTime !== undefined ? params.ApiTime : params.Api_000;
    const digits = rawDigits !== undefined && rawDigits !== null ? String(rawDigits).trim() : '';
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
