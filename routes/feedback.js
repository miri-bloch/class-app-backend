// דיווח על תקלות ובקשות לפיצ'רים — שולח מייל מעוצב לכתובת המערכת.

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// כתובת היעד של הדיווחים (ניתן לדרוס דרך משתני הסביבה)
const FEEDBACK_RECIPIENT = process.env.FEEDBACK_EMAIL || 'm9740628@gmail.com';

const TYPE_LABELS = {
  bug: '🐞 דיווח על תקלה',
  feature: '✨ בקשת פיצ\'ר',
  other: '📝 אחר'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildFeedbackEmail({ typeLabel, description, reporterName, reportedAt }) {
  return `
  <div dir="rtl" style="font-family: Arial, Helvetica, sans-serif; background: #f4f6f8; padding: 24px;">
    <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
      <div style="background: #0b1220; padding: 20px 24px;">
        <div style="color: #22d3ee; font-size: 20px; font-weight: bold;">HighCode System</div>
        <div style="color: #94a3b8; font-size: 13px; margin-top: 4px;">הודעה חדשה מהמערכת</div>
      </div>

      <div style="padding: 24px;">
        <div style="display: inline-block; background: #ecfeff; color: #0e7490; border-radius: 999px; padding: 6px 14px; font-size: 14px; font-weight: bold;">
          ${typeLabel}
        </div>

        <div style="margin-top: 20px; font-size: 14px; color: #475569; font-weight: bold;">תיאור הבקשה:</div>
        <div style="margin-top: 8px; padding: 16px; background: #f8fafc; border-right: 4px solid #22d3ee; border-radius: 6px; font-size: 15px; color: #1e293b; line-height: 1.7; white-space: pre-wrap;">${escapeHtml(description)}</div>

        <table style="width: 100%; margin-top: 24px; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; width: 120px;">נשלח על ידי:</td>
            <td style="padding: 8px 0; color: #1e293b; font-weight: bold;">${escapeHtml(reporterName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">תאריך ושעה:</td>
            <td style="padding: 8px 0; color: #1e293b;">${escapeHtml(reportedAt)}</td>
          </tr>
        </table>
      </div>
    </div>
  </div>`;
}

// שליחת דיווח חדש
router.post('/', auth, async (req, res) => {
  const { type, description } = req.body;
  const reporterName = req.user.full_name || req.user.email || 'משתמשת';
  const userId = req.user.id;

  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'יש לכתוב תיאור לפני השליחה' });
  }

  const typeLabel = TYPE_LABELS[type] || TYPE_LABELS.other;
  const reportedAt = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const subject = `${typeLabel} — ${reporterName}`;

  try {
    const sendEmail = req.app.locals.sendEmail;
    if (typeof sendEmail !== 'function') {
      throw new Error('שירות המייל אינו זמין כרגע');
    }

    await sendEmail(
      FEEDBACK_RECIPIENT,
      'מנהלת המערכת',
      subject,
      buildFeedbackEmail({ typeLabel, description, reporterName, reportedAt })
    );

    // שמירה ללוג מקומי — שימושי אם שליחת המייל נכשלת בהמשך
    await req.app.locals.pool?.query?.(
      `INSERT INTO feedback_reports (user_id, type, description) VALUES ($1, $2, $3)`,
      [userId, type || 'other', String(description).trim()]
    ).catch(() => {});

    res.json({ message: 'הדיווח נשלח בהצלחה, תודה!' });
  } catch (err) {
    console.error('שגיאה בשליחת דיווח:', err);
    res.status(500).json({ error: err.message || 'שגיאה בשליחת הדיווח' });
  }
});

module.exports = router;
