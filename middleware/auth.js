// תוכנת ביניים (Middleware) לאימות משתמשות.
//
// קיים מוד כפול:
//  1. מוד מאובטח (מומלץ) — הזהות נמסרת מתוך טוקן חתום בכותרת Authorization,
//     ולא ממה שהלקוח שולח בגוף הבקשה. כך אי אפשר לזייף "מי אני".
//  2. מוד תאימות (Legacy) — ללקוחות ישנים שעדיין שולחים userId בגוף/בשאילתא.
//     מופעל רק אם אין טוקן חוקי, כדי לא לשבור את ה-frontend הקיים.

const { verifyToken } = require('../services/tokenService');

// אימות חובה: ללא טוקן חוקי הבקשה נדחית עם 401.
function auth(req, res, next) {
  const user = resolveUser(req);
  if (!user) {
    return res.status(401).json({ error: 'נדרשת התחברות לביצוע פעולה זו' });
  }
  req.user = user;
  next();
}

// אימות עם תאימות לאחור (Backward Compatible)
// - אם קיים טוקן חוקי — הוא סמכותי.
// - אם לא — נשען על userId מהלקוח (מדור ישן).
function optionalAuth(req, res, next) {
  const user = resolveUser(req);
  if (user) {
    req.user = user;
  } else {
    req.user = null;
  }
  next();
}

// חולץ את הזהות: טוקן קודם כל, אחרת userId מצורת הבקשה.
function resolveUser(req) {
  const token = extractToken(req);
  if (token) {
    const user = verifyToken(token);
    if (user) {
      user.fromToken = true;
      return user;
    }
  }
  const legacyId = req.body?.userId ?? req.query?.userId ?? req.params?.userId ?? null;
  return legacyId ? { id: legacyId, fromToken: false } : null;
}

// קורא את הטוקן מכותרת Authorization בפורמט: Bearer <token>
function extractToken(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return header.trim() || null;
}

module.exports = { auth, optionalAuth };
