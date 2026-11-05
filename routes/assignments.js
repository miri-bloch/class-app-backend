const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db');
const {
  uploadFileToDrive,
  downloadFileFromDrive,
  deleteFileFromDrive,
} = require('../services/driveService');
const { auth, optionalAuth } = require('../middleware/auth');
const { sendBrandedEmailWithAttachment } = require('../services/emailService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// מקבל גם את השדה החדש (attachments, מרובה) וגם את הישן (attachment, בודד)
// כדי לא לשבור לקוחות קיימים.
const uploadAttachments = upload.fields([
  { name: 'attachments', maxCount: 10 },
  { name: 'attachment', maxCount: 1 }
]);

function collectUploadedFiles(req) {
  const grouped = req.files || {};
  return [...(grouped.attachments || []), ...(grouped.attachment || [])];
}

function normalizeFilename(filename) {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return /[֐-׿]/.test(decoded) ? decoded : filename;
}

// ───────────────────────────────────────────────────────────────────────────
// מחזור החיים של מטלה אצל משתמשת אחת:
//   • כולן רואות את כל המטלות — אלא אם מישהי הסירה/הסתירה אותה אצלה בלבד.
//   • is_dismissed — מחיקה עצמאית אצל המשתמשת בלבד. נשארת עד שהיא מחזירה.
//   • is_hidden    — הסתרה (עין). מטלה שבוצעה ומסומנת כ"בוצע" נעלמת אצלה
//                    48 שעות אחרי הסימון; הסתרה של מטלה שלא בוצעה נשארת עד
//                    שהמשתמשת מחזירה אותה.
//   • vanished_at  — חותמת "נעלמה אצלה" (48 שעות אחרי הביצוע).
//   • a.deleted_at — מחיקה לכולן (מחיקה רכה). מי שביצעה/הסירה — כבר לא רואה,
//                    מי שלא ביצעה רואה אותה עם ציון "נמחקה אצל כולן".
// ───────────────────────────────────────────────────────────────────────────

// המועד שבו ההסתרה של משתמשת מתפוגגת: 48 שעות מסימון "בוצע",
// אלא אם נקבע מועד ידני ב-hide_until.
function vanishAtExpression(alias = 'pn') {
  return `COALESCE(${alias}.hide_until, ${alias}.completed_at + INTERVAL '48 hours')`;
}

const VANISHED = (alias = 'pn') =>
  `(${alias}.vanished_at IS NOT NULL OR ${vanishAtExpression(alias)} <= NOW())`;
const DELETED = 'a.deleted_at IS NOT NULL';

// רושם vanished_at על הסתרות שהגיע מועדן. הרשומה נשארת (הביצוע וההערה
// נשמרים לסטטיסטיקות), רק המטלה מפסיקה להיות מוצגת למשתמשת.
async function sweepVanishedNotes(db = pool) {
  await db.query(`
    UPDATE private_notes pn
       SET vanished_at = ${vanishAtExpression('pn')}
     WHERE pn.is_hidden = TRUE
       AND pn.is_completed = TRUE
       AND pn.vanished_at IS NULL
       AND pn.completed_at IS NOT NULL
       AND ${vanishAtExpression('pn')} <= NOW()
  `);
}

// מוחקת מהמערכת מטלה שנמחקה לכולן, אחרי שכל מי שסימנה אותה כבוצעה
// כבר לא רואה אותה. משתמשת שלא ביצעה אותה — עדיין רואה אותה, ולכן
// כל עוד יש לה רשומה שאינה מבוצעת, המטלה נשארת במסד.
async function removeExpiredAssignments(db = pool) {
  await db.query(`
    DELETE FROM assignments a
     WHERE ${DELETED}
       AND NOT EXISTS (
         SELECT 1
           FROM private_notes pn
          WHERE pn.assignment_id = a.id
            AND COALESCE(pn.is_completed, FALSE) = FALSE
       )
  `);
}

// שליפת כל המטלות עבור משתמשת, כולל מצב ההעלמה האישי שלה.
async function loadAssignmentsForUser(db, userId) {
  await sweepVanishedNotes(db);
  await removeExpiredAssignments(db);

  const visibleNow = `(COALESCE(pn.is_dismissed, FALSE) OR ${VANISHED('pn')})`;

  return db.query(
    `SELECT a.*,
            COALESCE(a.as_quick, FALSE) AS as_quick,
            -- מחיקה לכולן + המשתמשת כבר סימנה בוצעה/הסירה → נעלמת אצלה
            (${DELETED} AND ${visibleNow}) AS is_deleted,
            pn.is_completed,
            pn.note_text,
            -- מוסתרת ע"י העין, אבל עוד לא עברה את מועד ההעלמה
            (COALESCE(pn.is_hidden, FALSE) AND NOT ${VANISHED('pn')}) AS is_hidden,
            COALESCE(pn.is_dismissed, FALSE) AS is_dismissed,
            ${VANISHED('pn')} AS has_vanished,
            pn.completed_at,
            ${vanishAtExpression('pn')} AS vanish_at,
            -- כמה זמן נשאר למטלה מוסתרת לפני שנעלמת (בשניות) — להצגה ב-UI
            GREATEST(
              0,
              EXTRACT(EPOCH FROM (${vanishAtExpression('pn')} - NOW()))
            )::INT AS vanish_in_seconds,
            -- סופרים ביצוע רק בקרב התלמידות הפעילות (is_student = TRUE)
            (SELECT COUNT(*) FROM private_notes pc
              JOIN users pc_u ON pc.user_id = pc_u.id
              WHERE pc.assignment_id = a.id
                AND pc.is_completed = TRUE
                AND pc_u.is_student = TRUE) AS completed_count,
            (SELECT COUNT(*) FROM users u WHERE u.is_student = TRUE) AS total_users,
            -- מציין אם המשתמשת הנוכחית היא תלמידה (להצגת משפט עדין לאחרות)
            (SELECT is_student FROM users WHERE id = $1) AS me_is_student,
            -- כל הקבצים המצורפים למטלה (השדות הישנים נשמרים לתאימות לאחור)
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', f.id,
                        'original_name', f.original_name,
                        'drive_file_id', f.drive_file_id,
                        'drive_web_view_link', f.drive_web_view_link
                      ) ORDER BY f.id)
                 FROM assignment_files f WHERE f.assignment_id = a.id),
              '[]'::json
            ) AS files
       FROM assignments a
       LEFT JOIN private_notes pn ON a.id = pn.assignment_id AND pn.user_id = $1
      ORDER BY a.due_date ASC`,
    [userId]
  );
}

// 1. קבלת כל המטלות (כולל הערות אישיות וסימון V למשתמשת מסוימת)
router.get('/', optionalAuth, async (req, res) => {
  // זהות סמכותית מהטוקן אם קיים (להתאמה אישית), אחרת (לגאסי) מהשאילתא
  const userId = req.user?.id ?? req.query.userId ?? null;

  const client = await pool.connect();
  try {
    // נעילת שורות ההערה של המשתמשת מונעת מצב שבו המטלה נמחקת לכולן
    // בדיוק בזמן שהיא רואה אותה — עדיף שיראה אותה פעם נוספת מאשר שיאבד.
    await client.query('BEGIN');
    if (userId) {
      await client.query('SELECT 1 FROM private_notes WHERE user_id = $1 FOR UPDATE', [userId]);
    }
    const result = await loadAssignmentsForUser(client, userId);
    await client.query('COMMIT');
    res.json(result.rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת המטלות' });
  } finally {
    client.release();
  }
});

// 2. הוספת מטלה חדשה (עם תמיכה בכמה קבצים בבת אחת)
router.post('/', optionalAuth, uploadAttachments, async (req, res) => {
  const { subject, title, description, due_date, difficulty_level } = req.body;
  const files = collectUploadedFiles(req);

  try {
    const newAssignment = await pool.query(
      `INSERT INTO assignments (subject, title, description, due_date, difficulty_level)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [subject, title, description, due_date, difficulty_level]
    );

    const assignmentId = newAssignment.rows[0].id;
    const savedFiles = [];

    // כל קובץ עולה בנפרד; כשל בקובץ אחד לא מבטל את שאר ההעלאה
    for (const file of files) {
      const attachmentName = normalizeFilename(file.originalname);
      try {
        const driveData = await uploadFileToDrive({ ...file, originalname: attachmentName });
        const row = await pool.query(
          `INSERT INTO assignment_files
             (assignment_id, original_name, drive_file_id, drive_web_view_link, mime_type)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [assignmentId, attachmentName, driveData.id, driveData.webViewLink || null, file.mimetype]
        );
        savedFiles.push(row.rows[0]);
      } catch (fileErr) {
        console.error(`שגיאה בהעלאת קובץ למטלה ${assignmentId}:`, fileErr.message);
      }
    }

    // שמירת הקובץ הראשון בשדות הישנים לתאימות לאחור עם לקוחות קיימים
    const first = savedFiles[0];
    if (first) {
      await pool.query(
        `UPDATE assignments
            SET drive_file_id = $1, drive_web_view_link = $2, attachment_name = $3
          WHERE id = $4`,
        [first.drive_file_id, first.drive_web_view_link, first.original_name, assignmentId]
      );
    }

    res.status(201).json({ ...newAssignment.rows[0], files: savedFiles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהוספת המטלה' });
  }
});

// 2א. מטלות מהירות — מטלה שמוסיפים בלי להתחבר, עם קובץ מצורף אופציונלי.
// הנתיב פתוח לחלוטין, ולכן מוגבל לכמה מטלות בדקה מכל כתובת IP.
// הטפסים נשלחים כ-multipart (כדי לאפשר קובץ); multer מפרק גם שדות טקסט
// שבהם, ולכן req.body מגיע רגיל. בקשת JSON פשוטה ממשיכה לעבוד כמו קודם.
const quickAddHits = new Map(); // ip -> [timestamps]
const QUICK_ADD_LIMIT = 5;
const QUICK_ADD_WINDOW_MS = 60 * 1000;
// מותר להוסיף מטלה שמועד ההגשה שלה כבר עבר — לכל היותר לפני שבוע.
const MAX_PAST_DAYS = 7;

function quickAddRateLimited(ip) {
  const now = Date.now();
  const hits = (quickAddHits.get(ip) || []).filter(ts => now - ts < QUICK_ADD_WINDOW_MS);
  if (hits.length >= QUICK_ADD_LIMIT) {
    quickAddHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  quickAddHits.set(ip, hits);
  return false;
}

// מגביל את הגוף של בקשות טקסט ב-URL של מטלות מהירות (מגן מפני טקסט ענק)
const quickJsonBody = express.json({ limit: '10kb' });

// קובץ יחיד למטלה מהירה; קובץ גדול מהמותר מחזיר הודעה ברורה במקום 500
const quickUpload = (req, res, next) => {
  uploadAttachments(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? 'הקובץ גדול מדי — עד 10MB' : 'לא ניתן לצרף את הקובץ'
      });
    }
    console.error(err);
    return res.status(400).json({ error: 'לא ניתן לצרף את הקובץ' });
  });
};

router.post(
  '/quick',
  (req, res, next) => (req.is('multipart/form-data') ? quickUpload(req, res, next) : quickJsonBody(req, res, next)),
  async (req, res) => {
    const { subject, title, due_date } = req.body || {};
    const files = collectUploadedFiles(req);

    // רק קובץ אחד למטלה מהירה — כדי שלא יוצף הנתיב הפתוח
    if (files.length > 1) {
      return res.status(400).json({ error: 'אפשר לצרף קובץ אחד בלבד' });
    }

    if (quickAddRateLimited(req.ip)) {
      return res.status(429).json({ error: 'יותר מדי מטלות בבת אחת. נסי שוב בעוד דקה.' });
    }

    const cleanSubject = String(subject || '').trim().slice(0, 100);
    const cleanTitle = String(title || '').trim().slice(0, 200);
    const cleanDate = String(due_date || '').trim();

    if (!cleanSubject) return res.status(400).json({ error: 'נא לבחור מקצוע' });
    if (!cleanTitle) return res.status(400).json({ error: 'נא למלא כותרת למטלה' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return res.status(400).json({ error: 'נא לבחור תאריך הגשה' });

    const dueDate = new Date(`${cleanDate}T00:00:00Z`);
    if (Number.isNaN(dueDate.getTime())) {
      return res.status(400).json({ error: 'תאריך ההגשה אינו תקין' });
    }
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const earliest = new Date(todayUtc);
    earliest.setUTCDate(earliest.getUTCDate() - MAX_PAST_DAYS);
    if (dueDate < earliest) {
      return res.status(400).json({ error: 'לא ניתן להוסיף מטלה שתאריך ההגשה שלה כבר עבר' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO assignments (subject, title, description, due_date, difficulty_level, as_quick)
         VALUES ($1, $2, NULL, $3, NULL, TRUE)
         RETURNING id, subject, title, due_date`,
        [cleanSubject, cleanTitle, cleanDate]
      );
      const assignment = result.rows[0];

      // הקובץ המצורף (אם יש) — העלאה לדרייב בתוך העסקה, כדי שמטלה לא
      // תיווצר בלי הקבצים שלה אם ההעלאה נכשלה.
      const savedFiles = [];
      for (const file of files) {
        const attachmentName = normalizeFilename(file.originalname);
        const driveData = await uploadFileToDrive({ ...file, originalname: attachmentName });
        const row = await client.query(
          `INSERT INTO assignment_files
             (assignment_id, original_name, drive_file_id, drive_web_view_link, mime_type)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [assignment.id, attachmentName, driveData.id, driveData.webViewLink || null, file.mimetype]
        );
        savedFiles.push(row.rows[0]);
      }

      // שמירת הקובץ הראשון בשדות הישנים לתאימות לאחור
      const first = savedFiles[0];
      if (first) {
        await client.query(
          `UPDATE assignments
              SET drive_file_id = $1, drive_web_view_link = $2, attachment_name = $3
            WHERE id = $4`,
          [first.drive_file_id, first.drive_web_view_link, first.original_name, assignment.id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ ...assignment, files: savedFiles });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(err);
      res.status(500).json({
        error: err.isDriveError
          ? 'לא הצלחתי להעלות את הקובץ — המטלה לא נוספה. נסי שוב בעוד רגע'
          : 'שגיאה בהוספת המטלה'
      });
    } finally {
      client.release();
    }
  }
);

// 7. כל קבצי המטלות, מקובצים לפי מקצוע — לטאב "קבצים לפי מקצוע".
// מוצב לפני /:id/files כדי שלא יתפרש כמזהה מטלה. כולל מטלות שנמחקו אצל כולן
// (הן מסומנות isDeleted), כי המשתמשת ביקשה שכל הקבצים יישארו נגישים.
router.get('/files-by-subject', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id AS assignment_id,
              a.subject,
              a.title,
              a.due_date,
              (a.deleted_at IS NOT NULL) AS is_deleted,
              f.id AS file_id,
              f.original_name,
              f.drive_web_view_link,
              f.mime_type,
              f.created_at AS file_created_at
         FROM assignments a
         JOIN assignment_files f ON f.assignment_id = a.id
        ORDER BY a.subject ASC, a.due_date DESC, f.id ASC`
    );

    const bySubject = new Map();
    for (const row of result.rows) {
      const key = row.subject || 'כללי';
      if (!bySubject.has(key)) bySubject.set(key, []);
      bySubject.get(key).push({
        fileId: row.file_id,
        assignmentId: row.assignment_id,
        assignmentTitle: row.title,
        dueDate: row.due_date,
        isDeleted: row.is_deleted,
        originalName: row.original_name,
        webViewLink: row.drive_web_view_link,
        mimeType: row.mime_type,
        createdAt: row.file_created_at,
      });
    }

    res.json(
      [...bySubject.entries()].map(([subject, files]) => ({ subject, files }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת הקבצים לפי מקצוע' });
  }
});

// 2ב. שליפת כל הקבצים המצורפים למטלה
router.get('/:id/files', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, original_name, drive_file_id, drive_web_view_link, mime_type
         FROM assignment_files
        WHERE assignment_id = $1
        ORDER BY id ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בשליפת קבצי המטלה' });
  }
});

// 3. עדכון סימון V / הערה אישית למשתמשת.
//   • סימון בוצע → completed_at נרשם והמטלה מוסתרת אצלה (עין).
//   • ביטול הסימון → המטלה חוזרת לרשימה (ומתבטל גם כל "נעלמה" קודם).
router.post('/:id/note', optionalAuth, async (req, res) => {
  const assignmentId = req.params.id;
  const { note_text, is_completed } = req.body;
  // זהות סמכותית מהטוקן אם קיים (במוד תאימות — מה-body)
  const userId = req.user?.id ?? req.body.userId ?? null;

  if (!userId) {
    return res.status(401).json({ error: 'נדרשת התחברות לסימון מטלה' });
  }

  const completed = Boolean(is_completed);
  // $4 = completed, $5 = האם הרשומה הייתה כבר מסומנת כבוצעה
  const wasCompleted = `COALESCE(private_notes.is_completed, FALSE)`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO private_notes (user_id, assignment_id, note_text, is_completed, completed_at, hide_until)
       VALUES ($1, $2, $3, $4,
               CASE WHEN $4 THEN NOW() END,
               CASE WHEN $4 THEN NOW() + INTERVAL '48 hours' END)
       ON CONFLICT (user_id, assignment_id)
       DO UPDATE SET
         note_text = EXCLUDED.note_text,
         is_completed = EXCLUDED.is_completed,
         -- סימון חוזר של מטלה שכבר בוצעה לא מאפס את ספירת 48 השעות
         completed_at = CASE
                          WHEN EXCLUDED.is_completed AND ${wasCompleted} THEN private_notes.completed_at
                          WHEN EXCLUDED.is_completed THEN NOW()
                          ELSE NULL
                        END,
         -- הסתרה אוטומטית עם הסימון; ביטול הסימון מחזיר את המטלה
         is_hidden = CASE WHEN EXCLUDED.is_completed THEN TRUE ELSE FALSE END,
         vanished_at = NULL,
         hide_until = CASE
                        WHEN EXCLUDED.is_completed AND ${wasCompleted} THEN private_notes.hide_until
                        WHEN EXCLUDED.is_completed THEN NOW() + INTERVAL '48 hours'
                        ELSE NULL
                      END,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [userId, assignmentId, note_text || '', completed]
    );
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // 23503 = הפרת מפתח זר, כלומר המטלה או המשתמשת כבר לא קיימות
    if (err.code === '23503') {
      return res.status(404).json({ error: 'המטלה לא נמצאה' });
    }
    console.error(err);
    res.status(500).json({ error: 'שגיאה בעדכון ההערה האישית' });
  } finally {
    client.release();
  }
});

// 4. חישוב אחוזי ביצוע כיתתיים לכל מטלה
router.get('/stats/completion', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.subject, a.title,
              -- ביצוע נספר רק בקרב התלמידות הפעילות
              COUNT(pn.id) FILTER (WHERE pn.is_completed = TRUE AND u.is_student = TRUE) as completed_count,
              (SELECT COUNT(*) FROM users WHERE is_student = TRUE) as total_users
       FROM assignments a
       LEFT JOIN private_notes pn ON a.id = pn.assignment_id
       LEFT JOIN users u ON pn.user_id = u.id
      GROUP BY a.id, a.subject, a.title`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בחישוב אחוזי הביצוע' });
  }
});

// 5א. הסרה אישית — המטלה נעלמת רק מהמשתמשת הזו, נשארת אצל כל השאר.
// נשמרת ב-is_dismissed (ולא ב-is_hidden), כדי שלא תעלם אחרי 48 שעות
// ושההסתרה של העין תישאר נפרדת.
router.delete('/:id/personal', auth, async (req, res) => {
  const assignmentId = req.params.id;
  const userId = req.user.id;

  try {
    await pool.query(
      `INSERT INTO private_notes (user_id, assignment_id, note_text, is_completed, is_dismissed)
       VALUES ($1, $2, '', FALSE, TRUE)
       ON CONFLICT (user_id, assignment_id)
       DO UPDATE SET
         is_dismissed = TRUE,
         is_hidden = FALSE,
         hide_until = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, assignmentId]
    );

    res.json({ message: 'המטלה הוסרה מהרשימה האישית שלך בלבד', dismissed: true });
  } catch (err) {
    // 23503 = הפרת מפתח זר, כלומר המטלה כבר לא קיימת
    if (err.code === '23503') {
      return res.status(404).json({ error: 'המטלה לא נמצאה' });
    }
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהסרת המטלה האישית' });
  }
});

// 5א2. שחזור — מבטל את כל ההעלמה האישית: הסרה עצמאית, הסתרת עין
// ואפילו "נעלמה אחרי 48 שעות" (המשתמשת החליטה להחזיר אותה).
router.post('/:id/personal/restore', auth, async (req, res) => {
  const assignmentId = req.params.id;
  const userId = req.user.id;

  try {
    await pool.query(
      `UPDATE private_notes
          SET is_dismissed = FALSE,
              is_hidden = FALSE,
              vanished_at = NULL,
              hide_until = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND assignment_id = $2`,
      [userId, assignmentId]
    );

    res.json({ message: 'המטלה הוחזרה לרשימה שלך', dismissed: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה בהחזרת המטלה' });
  }
});

// 5א3. העין — הסתרה/החזרה של מטלה, בלי לגעת במחיקה העצמאית.
// אפשר להסתיר גם מטלה שעוד לא סומנה כבוצעה. הסתרה של מטלה שסומנה
// מתפוגגת אחרי 48 שעות מסימון הביצוע; הסתרה של מטלה שלא סומנה נשארת
// עד שהמשתמשת מחזירה אותה. אחרי ההתפוגגות ההחזרה מתאפשרת רק דרך
// /personal/restore (מפורש).
router.post('/:id/toggle-hidden', auth, async (req, res) => {
  const assignmentId = req.params.id;
  const userId = req.user.id;
  const { hidden } = req.body || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // מבטיחים שהמטלה קיימת לפני שיוצרים רשומה אישית
    const assignment = await client.query(
      'SELECT id, deleted_at FROM assignments WHERE id = $1',
      [assignmentId]
    );
    if (assignment.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'המטלה לא נמצאה' });
    }
    if (assignment.rows[0].deleted_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'המטלה נמחקה אצל כולן ולא ניתן לשנות אותה' });
    }

    const current = await client.query(
      'SELECT * FROM private_notes WHERE user_id = $1 AND assignment_id = $2 FOR UPDATE',
      [userId, assignmentId]
    );
    const pn = current.rows[0] || null;
    const isCompleted = Boolean(pn && pn.is_completed);
    const willHide = hidden === undefined ? !(pn && pn.is_hidden) : Boolean(hidden);

    if (willHide) {
      if (isCompleted) {
        // מטלה שבוצעה: מרגע ההסתרה מחדש מתחילים ספירה חדשה של 48 שעות
        await client.query(
          `INSERT INTO private_notes (user_id, assignment_id, note_text, is_hidden, completed_at, hide_until)
           VALUES ($1, $2, '', TRUE, NOW(), NOW() + INTERVAL '48 hours')
           ON CONFLICT (user_id, assignment_id)
           DO UPDATE SET
             is_hidden = TRUE,
             vanished_at = NULL,
             completed_at = NOW(),
             hide_until = NOW() + INTERVAL '48 hours',
             updated_at = CURRENT_TIMESTAMP`,
          [userId, assignmentId]
        );
      } else {
        // מטלה שלא בוצעה: הסתרה בלי שעון 48 שעות — נשארת מוסתרת עד החזרה
        await client.query(
          `INSERT INTO private_notes (user_id, assignment_id, note_text, is_hidden, is_completed, completed_at, hide_until)
           VALUES ($1, $2, '', TRUE, FALSE, NULL, NULL)
           ON CONFLICT (user_id, assignment_id)
           DO UPDATE SET
             is_hidden = TRUE,
             vanished_at = NULL,
             hide_until = NULL,
             updated_at = CURRENT_TIMESTAMP`,
          [userId, assignmentId]
        );
      }
    } else {
      if (pn) {
        await client.query(
          `UPDATE private_notes
              SET is_hidden = FALSE,
                  vanished_at = NULL,
                  hide_until = NULL,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [pn.id]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ hidden: willHide });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'שגיאה בעדכון ההסתרה' });
  } finally {
    client.release();
  }
});

// 5ב. מחיקת מטלה לכולן — מחיקה רכה (deleted_at), כדי שמי שלא ביצעה
// עדיין תראה אותה עם ציון, ומי שביצעה כבר לא תראה אותה.
router.delete('/:id', async (req, res) => {
  const assignmentId = req.params.id;

  try {
    const result = await pool.query(
      'UPDATE assignments SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [assignmentId]
    );

    if (result.rows.length === 0) {
      // או שהמטלה לא קיימת, או שכבר נמחקה קודם
      const exists = await pool.query('SELECT 1 FROM assignments WHERE id = $1', [assignmentId]);
      if (exists.rows.length === 0) {
        return res.status(404).json({ error: 'המטלה לא נמצאה' });
      }
      return res.json({ message: 'המטלה נמחקה בהצלחה' });
    }

    res.json({ message: 'המטלה נמחקה בהצלחה' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה במחיקת המטלה' });
  }
});

// 6. שליחת קובץ המטלה למייל של המשתמשת המחוברת.
//   • מטלה עם קובץ אחד — נשלח אותו קובץ.
//   • מטלה עם כמה קבצים — חייבים לבחור אחד ב-fileId; בלי בחירה מוחזרת
//     רשימת הקבצים (400) כדי שהממשק יציג בחירה.
router.post('/:id/send-to-email', auth, async (req, res) => {
  const assignmentId = req.params.id;
  const userId = req.user?.id;
  const requestedFileId = req.body?.fileId != null ? Number(req.body.fileId) : null;

  try {
    const result = await pool.query(
      'SELECT * FROM assignments WHERE id = $1',
      [assignmentId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'המטלה לא נמצאה' });
    }

    const assignment = result.rows[0];
    if (assignment.deleted_at) {
      return res.status(400).json({ error: 'המטלה נמחקה אצל כולן ולא ניתן לשלוח אותה' });
    }

    const filesRes = await pool.query(
      `SELECT id, original_name, drive_file_id, mime_type
         FROM assignment_files
        WHERE assignment_id = $1
        ORDER BY id ASC`,
      [assignmentId]
    );
    const files = filesRes.rows;

    let chosen = null;
    if (requestedFileId) {
      chosen = files.find((f) => f.id === requestedFileId) || null;
      if (!chosen) {
        // ייתכן שמדובר בקובץ הישן (drive_file_id) שאין לו רשומה בטבלה
        if (
          files.length === 0 &&
          assignment.drive_file_id &&
          Number.isInteger(requestedFileId)
        ) {
          chosen = {
            id: null,
            original_name: assignment.attachment_name || 'קובץ שיעור',
            drive_file_id: assignment.drive_file_id,
            mime_type: null,
          };
        } else {
          return res.status(404).json({ error: 'הקובץ לא נמצא במטלה זו' });
        }
      }
    } else if (files.length === 1) {
      chosen = files[0];
    } else if (files.length === 0 && assignment.drive_file_id) {
      // תאימות לאחור — מטלה ישנה עם קובץ יחיד בשדות הישנים
      chosen = {
        id: null,
        original_name: assignment.attachment_name || 'קובץ שיעור',
        drive_file_id: assignment.drive_file_id,
        mime_type: null,
      };
    } else if (files.length > 1) {
      return res.status(400).json({
        error: 'למטלה זו כמה קבצים — נא לבחור איזה קובץ לשלוח',
        needsFileChoice: true,
        files: files.map((f) => ({ id: f.id, originalName: f.original_name })),
      });
    } else {
      return res.status(400).json({ error: 'למטלה זו אין קובץ מצורף' });
    }

    // מיילה של המשתמשת המחוברת
    const userRes = await pool.query(
      'SELECT full_name, email FROM users WHERE id = $1',
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'המשתמשת לא נמצאה' });
    }
    const user = userRes.rows[0];

    // הורדת הקובץ מ-Google Drive
    const buffer = await downloadFileFromDrive(chosen.drive_file_id);
    const fileName = chosen.original_name || 'קובץ שיעור';

    const contentHtml = `
      <div style="font-size: 16px; color: #cbd5e1; margin-bottom: 10px;">שלום ${user.full_name},</div>
      <div style="font-size: 14px; color: #94a3b8; line-height: 1.6;">צורפה למייל זה מטלה: ${assignment.title} (${assignment.subject || 'כללי'}).</div>
    `;

    await sendBrandedEmailWithAttachment(
      user.email,
      `📎 קובץ המטלה: ${assignment.title}`,
      'ASSIGNMENT FILE',
      contentHtml,
      { buffer, name: fileName, mimeType: chosen.mime_type || undefined }
    );

    res.json({ message: 'הקובץ נשלח בהצלחה למייל שלך!' });
  } catch (err) {
    console.error('שגיאה בשליחת הקובץ למייל:', err);
    // הקובץ נמחק מהדרייב — זו אינה תקלת שרת אלא מידע שהמשתמשת צריכה לקבל
    // כדי לדעת שעליה להעלות את המטלה מחדש.
    if (err && err.isFileGone) {
      return res.status(404).json({
        error: 'הקובץ המצורף של המטלה הזו נמחק מהדרייב ולכן אינו זמין יותר. יש להעלות את המטלה מחדש.',
        fileGone: true,
      });
    }
    if (err && err.isDriveError) {
      return res.status(502).json({ error: 'שגיאה בהורדת הקובץ מהדרייב. נסי שוב בעוד רגע.' });
    }
    // הקובץ ירד מהדרייב בהצלחה, ולכן הכשל הוא בשירות המייל עצמו
    if (err && err.isEmailError) {
      return res.status(502).json({ error: err.message, emailFailed: true });
    }
    res.status(500).json({ error: 'שגיאה בשליחת הקובץ למייל' });
  }
});

// 8א. עריכת מטלה — כל משתמשת מחוברת. אפשר לעדכן מקצוע/כותרת/פירוט/תאריך
// ולהוסיף קבצים. מטלה שנמחקה אצל כולן אינה ניתנת לעריכה.
router.put('/:id', auth, uploadAttachments, async (req, res) => {
  const assignmentId = req.params.id;
  const {
    subject,
    title,
    description,
    due_date,
    removeFileIds,
  } = req.body || {};
  const files = collectUploadedFiles(req);

  const cleanSubject = String(subject || '').trim().slice(0, 100);
  const cleanTitle = String(title || '').trim().slice(0, 200);
  const cleanDescription =
    description === undefined || description === null
      ? null
      : String(description).trim().slice(0, 4000);
  const cleanDate = String(due_date || '').trim();

  if (!cleanSubject) return res.status(400).json({ error: 'נא לבחור מקצוע' });
  if (!cleanTitle) return res.status(400).json({ error: 'נא למלא כותרת למטלה' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return res.status(400).json({ error: 'נא לבחור תאריך הגשה' });
  }
  const dueDate = new Date(`${cleanDate}T00:00:00Z`);
  if (Number.isNaN(dueDate.getTime())) {
    return res.status(400).json({ error: 'תאריך ההגשה אינו תקין' });
  }

  // רשימת קבצים למחיקה מגיעה כ-JSON או כמחרוזת מופרדת בפסיקים
  let fileIdsToRemove = [];
  if (removeFileIds !== undefined && removeFileIds !== null && removeFileIds !== '') {
    try {
      const parsed =
        typeof removeFileIds === 'string' ? JSON.parse(removeFileIds) : removeFileIds;
      if (Array.isArray(parsed)) {
        fileIdsToRemove = parsed.map(Number).filter(Number.isInteger);
      }
    } catch {
      fileIdsToRemove = String(removeFileIds)
        .split(',')
        .map((v) => Number(v.trim()))
        .filter(Number.isInteger);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE assignments
          SET subject = $2,
              title = $3,
              description = $4,
              due_date = $5
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING *`,
      [assignmentId, cleanSubject, cleanTitle, cleanDescription, cleanDate]
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      const exists = await client.query('SELECT deleted_at FROM assignments WHERE id = $1', [
        assignmentId,
      ]);
      if (exists.rows.length === 0) {
        return res.status(404).json({ error: 'המטלה לא נמצאה' });
      }
      return res.status(400).json({ error: 'המטלה נמחקה אצל כולן ולא ניתן לערוך אותה' });
    }

    // מחיקת קבצים שנבחרו (רק כאלה ששייכים למטלה הזו)
    if (fileIdsToRemove.length > 0) {
      await client.query(
        `DELETE FROM assignment_files
          WHERE assignment_id = $1 AND id = ANY($2::int[])`,
        [assignmentId, fileIdsToRemove]
      );
    }

    // הוספת קבצים חדשים
    const savedFiles = [];
    for (const file of files) {
      const attachmentName = normalizeFilename(file.originalname);
      const driveData = await uploadFileToDrive({ ...file, originalname: attachmentName });
      const row = await client.query(
        `INSERT INTO assignment_files
           (assignment_id, original_name, drive_file_id, drive_web_view_link, mime_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [assignmentId, attachmentName, driveData.id, driveData.webViewLink || null, file.mimetype]
      );
      savedFiles.push(row.rows[0]);
    }

    // סנכרון השדות הישנים: הקובץ הראשון שנותר, או ניקוי אם לא נותרו קבצים
    const remaining = await client.query(
      `SELECT original_name, drive_file_id, drive_web_view_link
         FROM assignment_files
        WHERE assignment_id = $1
        ORDER BY id ASC
        LIMIT 1`,
      [assignmentId]
    );
    const first = remaining.rows[0] || null;
    await client.query(
      `UPDATE assignments
          SET drive_file_id = $2,
              drive_web_view_link = $3,
              attachment_name = $4
        WHERE id = $1`,
      [
        assignmentId,
        first ? first.drive_file_id : null,
        first ? first.drive_web_view_link : null,
        first ? first.original_name : null,
      ]
    );

    await client.query('COMMIT');
    res.json({ ...updated.rows[0], files: savedFiles });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    if (err && err.isDriveError) {
      return res.status(502).json({ error: 'לא הצלחתי להעלות את הקובץ — נסי שוב בעוד רגע' });
    }
    res.status(500).json({ error: 'שגיאה בעריכת המטלה' });
  } finally {
    client.release();
  }
});

// 8ב. מחיקת קובץ בודד ממטלה — מוחק גם מהדרייב, ואם לא נותרו קבצים
// מנקה את השדות הישנים.
router.delete('/:id/files/:fileId', auth, async (req, res) => {
  const assignmentId = req.params.id;
  const fileId = Number(req.params.fileId);

  if (!Number.isInteger(fileId)) {
    return res.status(400).json({ error: 'מזהה קובץ לא תקין' });
  }

  try {
    const fileRes = await pool.query(
      'SELECT * FROM assignment_files WHERE id = $1 AND assignment_id = $2',
      [fileId, assignmentId]
    );
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'הקובץ לא נמצא במטלה זו' });
    }
    const file = fileRes.rows[0];

    // הקובץ על הדרייב אינו מוחק את הרשומה במסד אם ההידרדרות נכשלה
    try {
      await deleteFileFromDrive(file.drive_file_id);
    } catch (err) {
      console.warn('לא הצלחתי למחוק את הקובץ מהדרייב:', err.message);
    }

    await pool.query('DELETE FROM assignment_files WHERE id = $1', [fileId]);

    const remaining = await pool.query(
      `SELECT original_name, drive_file_id, drive_web_view_link
         FROM assignment_files
        WHERE assignment_id = $1
        ORDER BY id ASC
        LIMIT 1`,
      [assignmentId]
    );
    const first = remaining.rows[0] || null;
    await pool.query(
      `UPDATE assignments
          SET drive_file_id = $2,
              drive_web_view_link = $3,
              attachment_name = $4
        WHERE id = $1`,
      [
        assignmentId,
        first ? first.drive_file_id : null,
        first ? first.drive_web_view_link : null,
        first ? first.original_name : null,
      ]
    );

    res.json({ message: 'הקובץ נמחק בהצלחה' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'שגיאה במחיקת הקובץ' });
  }
});

module.exports = router;
