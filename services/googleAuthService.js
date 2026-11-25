// התחברות באמצעות חשבון גוגל (OAuth 2.0 — Authorization Code עם PKCE).
//
// הזרימה:
//  1. השרת מייצר "state" אקראי + "code_verifier" ל-PKCE, שומר אותם בענן
//     זמני (טבלת oauth_states) ומפנה את המשתמשת למסך ההסכמה של גוגל.
//  2. גוגל מחזירה את המשתמשת לכתובת ה-callback עם code + state.
//  3. השרת מושך את ה-state (ונמחק אותו — חד-פעמי), מחליף את ה-code בטוקן
//     הרשאת גישה ושולף ממנו את המייל המאומת והשם.
//
// אין תלות בספרייה חיצונית — רק crypto מקורי של Node ו-fetch המובנה,
// כדי שהמערכת תעבוד גם בסביבה מסוננת ללא התקנות חדשות.

const crypto = require('crypto');
const pool = require('../db');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

function getClientId() {
  return process.env.GOOGLE_LOGIN_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
}

function getClientSecret() {
  return process.env.GOOGLE_LOGIN_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '';
}

// הכתובת שהמשתמשת חוזרת אליה מגוגל. חייבת להיות זהה לחלוטין לזו שרשומה
// ב-Google Cloud Console, אחרת גוגל מחזירה redirect_uri_mismatch.
function getRedirectUri(req) {
  if (process.env.GOOGLE_LOGIN_REDIRECT_URI) return process.env.GOOGLE_LOGIN_REDIRECT_URI;
  return `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

function isConfigured() {
  return Boolean(getClientId() && getClientSecret());
}

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

// מחזיר אובייקט עם כל מה שצריך כדי להתחיל את הזרימה
async function createAuthRequest() {
  const state = toBase64Url(crypto.randomBytes(32));
  const codeVerifier = toBase64Url(crypto.randomBytes(48));
  const codeChallenge = toBase64Url(crypto.createHash('sha256').update(codeVerifier).digest());

  await pool.query(
    `INSERT INTO oauth_states (state, code_verifier)
     VALUES ($1, $2)
     ON CONFLICT (state) DO NOTHING`,
    [state, codeVerifier]
  );
  // ניקוי states שפגו (אין טעם לשמור אותם)
  pool.query(
    "DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '10 minutes'"
  ).catch(() => {});

  return { state, codeChallenge };
}

function buildAuthUrl(req, { state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // בחירת חשבון בכל התחברות — לא מדלגים על המסך של גוגל
    prompt: 'select_account'
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// שולף ומוחק את ה-state — חד-פעמי, כדי שלא ניתן יהיה להשתמש בו פעמיים
async function consumeState(state) {
  if (!state) return null;
  const result = await pool.query(
    `DELETE FROM oauth_states
      WHERE state = $1 AND created_at > NOW() - INTERVAL '10 minutes'
      RETURNING code_verifier`,
    [state]
  );
  return result.rows[0]?.code_verifier || null;
}

// מחליף code בטוקן גישה ושולף את פרטי החשבון המאומתים
async function exchangeCodeForUser(req, code, codeVerifier) {
  const body = new URLSearchParams({
    code,
    client_id: getClientId(),
    client_secret: getClientSecret(),
    redirect_uri: getRedirectUri(req),
    grant_type: 'authorization_code',
    code_verifier: codeVerifier
  });

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    const reason = tokenData.error_description || tokenData.error || `HTTP ${tokenRes.status}`;
    throw new Error(`החלפת הקוד בטוקן נכשלה: ${reason}`);
  }

  const infoRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const info = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !info.email) {
    throw new Error('לא הצלחנו לקבל את פרטי החשבון מגוגל');
  }

  // גוגל מסמנת verified_email=true עבור כתובות שנבדקו — רק בהן נשתמש
  if (info.verified_email === false || info.email_verified === false) {
    throw new Error('כתובת המייל של חשבון גוגל אינה מאומתת');
  }

  return {
    email: String(info.email).trim().toLowerCase(),
    full_name: info.name || null,
    sub: info.sub || null
  };
}

module.exports = {
  isConfigured,
  createAuthRequest,
  buildAuthUrl,
  consumeState,
  exchangeCodeForUser
};
