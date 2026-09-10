// שירות חתימת ואימות טוקנים מאובטחים (JWT-סגנון) באמצעות crypto מקורי של Node -
// ללא תלות בספריות חיצוניות, כך שהמערכת עובדת גם בסביבות מסוננות ללא התקנות חדשות.

const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 ימים — תואם למשך הסשן השמור ב-frontend

// קידוד Base64url (בטוח לכתובות / כותרות)
function toBase64Url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// חותם ומחזיר טוקן המכיל את זיהוי המשתמשת, שם ותאריך תפוגה.
function signToken(user) {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    sub: user.id,
    name: user.full_name,
    usr: user.email,
    iat: Date.now(),
    exp: Date.now() + TTL_MS
  }));
  const signature = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// מאמת את החתימה והתפוגה ומחזיר את פרטי המשתמשת, או null אם הטוקן לא תקין/פג.
function verifyToken(token) {
  try {
    const [header, payload, signature] = String(token).split('.');
    if (!header || !payload || !signature) return null;

    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
    // השוואה בקבוע זמן למניעת תזמון (Timing Attack)
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const data = JSON.parse(fromBase64Url(payload));
    if (typeof data.exp !== 'number' || Date.now() > data.exp) return null;

    return {
      id: data.sub,
      full_name: data.name || null,
      email: data.usr || null
    };
  } catch (err) {
    return null;
  }
}

module.exports = { signToken, verifyToken };
