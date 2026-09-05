const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// תבנית מעטפת כללית אחידה לכל מיילי המערכת לפי עיצוב הלוגו והכרטיס המדויק
function getBaseEmailTemplate(subtitleText, contentHtml) {
  return `
    <div dir="rtl" style="background-color: #050508; color: #ffffff; font-family: 'Heebo', Arial, sans-serif; padding: 40px 15px; text-align: center;">
      <div style="max-width: 600px; margin: auto;">
        
        <!-- לוגו מדויק עם שני צבעים וכותרת משנה -->
        <div style="margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 900; letter-spacing: 1px;">
            <span style="color: #22d3ee;">// Dev</span><span style="color: #c084fc;">Space</span>
          </h1>
          <p style="color: #64748b; font-size: 11px; margin: 6px 0 0 0; text-transform: uppercase; letter-spacing: 3px; font-weight: bold;">${subtitleText}</p>
        </div>

        <!-- כרטיס זכוכית מרכזי ממוורכז ומעוצב -->
        <div style="background-color: #0b0b12; border: 1px solid rgba(34, 211, 238, 0.25); border-radius: 14px; padding: 35px 25px; margin-bottom: 25px; text-align: center; box-shadow: 0 4px 25px rgba(0,0,0,0.6);">
          ${contentHtml}
        </div>

        <!-- פוטר מערכת -->
        <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 20px;">
          <p style="font-size: 11px; color: #64748b; margin: 0;">M BLOCH - DevSpace © כל הזכויות שמורות</p>
        </div>

      </div>
    </div>
  `;
}

// 1. מייל שחזור סיסמה מעוצב בדיוק לפי הדרישה והתמונה
async function sendPasswordResetEmail(toEmail, userName, password) {
  const content = `
    <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 20px;">
      שחזור סיסמה למערכת 🔐
    </div>
    <div style="font-size: 15px; color: #cbd5e1; margin-bottom: 8px;">
      שלום ${userName},
    </div>
    <div style="font-size: 14px; color: #94a3b8; margin-bottom: 25px;">
      הנה הפרטים לשחזור הגישה למערכת שלך:
    </div>
    <div style="display: inline-block; background: rgba(34, 211, 238, 0.05); border: 2px dashed #22d3ee; padding: 12px 30px; border-radius: 10px; font-size: 24px; font-weight: bold; color: #22d3ee; margin-bottom: 25px; letter-spacing: 2px;">
      ${password}
    </div>
    <div style="font-size: 12px; color: #64748b;">
      מומלץ להתחבר למערכת ולשמור את הסיסמה במקום בטוח.
    </div>
  `;

  await transporter.sendMail({
    from: `"DevSpace System" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'שחזור סיסמה - DevSpace',
    html: getBaseEmailTemplate('PASSWORD RECOVERY', content)
  });
}

// 2. מייל עדכון שיעורי בית מעוצב במרכז
async function sendHomeworkDigest(toEmail, userName, assignments) {
  if (!assignments || assignments.length === 0) return;

  const assignmentListHtml = assignments.map(a => `
    <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(34,211,238,0.2); padding: 12px; border-radius: 8px; margin-bottom: 12px; text-align: right;">
      <strong style="color: #ffffff; font-size: 15px;">${a.title}</strong> <span style="color: #22d3ee; font-size: 13px;">(${a.subject})</span><br/>
      <span style="color: #94a3b8; font-size: 12px;">תאריך הגשה: ${new Date(a.due_date).toLocaleDateString('he-IL')}</span>
    </div>
  `).join('');

  const content = `
    <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">
      שלום ${userName}, מה חדש בשיעורי הבית? 📚
    </div>
    <div style="font-size: 14px; color: #cbd5e1; margin-bottom: 20px;">
      הנה ריכוז המטלות הפעילות הממתינות לך:
    </div>
    <div style="max-width: 450px; margin: auto;">
      ${assignmentListHtml}
    </div>
  `;

  await transporter.sendMail({
    from: `"DevSpace System" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: '🔔 עדכון שיעורי בית ומטלות קרובות',
    html: getBaseEmailTemplate('HOMEWORK NOTIFICATION', content)
  });
}

// 3. מייל תורנות חלב מעוצב במרכז
async function sendMilkDutyEmail(toEmail, userName) {
  const content = `
    <div style="font-size: 20px; font-weight: bold; color: #22d3ee; margin-bottom: 15px;">
      שלום ${userName}, הגיע תורך בתורנות החלב! 🥛
    </div>
    <div style="font-size: 14px; color: #cbd5e1; line-height: 1.6;">
      התור הקודם הושלם בהצלחה, כעת עליך לדאוג לרכש החלב עבור הכיתה.
    </div>
  `;

  await transporter.sendMail({
    from: `"DevSpace System" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: '🥛 תורנות חלב - DevSpace',
    html: getBaseEmailTemplate('MILK DUTY NOTIFICATION', content)
  });
}

module.exports = { sendPasswordResetEmail, sendHomeworkDigest, sendMilkDutyEmail };