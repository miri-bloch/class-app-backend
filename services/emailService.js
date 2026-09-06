require('dotenv').config();

// פונקציית עזר כללית לשליחת מייל דרך Brevo
async function sendBrevoEmail(toEmail, subject, htmlContent) {
  await sendEmail(toEmail, subject, htmlContent);
}

function createBrevoEmail({ toEmail, subject, htmlContent }) {
  const recipients = Array.isArray(toEmail) ? toEmail : [toEmail];
  return {
    sender: { name: 'DevSpace System', email: process.env.SENDER_EMAIL || process.env.EMAIL_USER },
    to: recipients.map(email => ({ email })),
    subject,
    htmlContent,
  };
}

async function sendEmail(toEmail, subject, htmlContent) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(createBrevoEmail({ toEmail, subject, htmlContent })),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// תבנית מעטפת כללית אחידה לכל מיילי המערכת לפי עיצוב הלוגו והכרטיס המדויק
function getBaseEmailTemplate(subtitleText, contentHtml) {
  return `
    <div dir="rtl" style="background-color: #050508; color: #ffffff; font-family: 'Heebo', Arial, sans-serif; padding: 40px 15px; text-align: center;">
      <div style="max-width: 600px; margin: auto;">
        
        <!-- לוגו המערכת בצבעי הטורקיז והסגול -->
        <div style="margin-bottom: 30px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 900; letter-spacing: 1px; line-height: 1;">
            <span style="display: inline-block; background: linear-gradient(135deg, #22d3ee, #c084fc); color: #050508; font-size: 13px; letter-spacing: 0; padding: 7px 6px 5px; border-radius: 7px; vertical-align: middle; margin-left: 8px;">DS</span><span style="color: #ffffff;">DEV</span><span style="color: #22d3ee;">SPACE</span>
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

async function sendBrandedEmail(toEmail, subject, subtitleText, contentHtml) {
  await sendEmail(toEmail, subject, getBaseEmailTemplate(subtitleText, contentHtml));
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

  await sendBrevoEmail(
    toEmail,
    'שחזור סיסמה - DevSpace',
    getBaseEmailTemplate('PASSWORD RECOVERY', content)
  );
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

  await sendBrevoEmail(
    toEmail,
    '🔔 עדכון שיעורי בית ומטלות קרובות',
    getBaseEmailTemplate('HOMEWORK NOTIFICATION', content)
  );
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

  await sendBrevoEmail(
    toEmail,
    '🥛 תורנות חלב - DevSpace',
    getBaseEmailTemplate('MILK DUTY NOTIFICATION', content)
  );
}

module.exports = { sendPasswordResetEmail, sendHomeworkDigest, sendMilkDutyEmail, sendEmail, sendBrandedEmail };