// שירות גיבוב ואמת סיסמאות באמצעות bcryptjs.
// פונקציות עזר אחידות לרישום והתחברות — כך שגם משתמשות חדשות (bcrypt)
// וגם רשומות ישנות (שפה ברורה) מטופלות במקום אחד.

const bcrypt = require('bcryptjs');

// מחזירה TRUE אם הערך השמור הוא גיבוב bcrypt (ניתן לזיהוי לפי הקידומת "$2")
function isHashed(value) {
  return typeof value === 'string' && value.startsWith('$2');
}

// מגהבת סיסמה חדשה לפני שמירה (עבור רישום חדש)
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 10);
}

// משווה סיסמה שהתקבלה לבין הערך השמור במסד:
// - אם הערך הוא גיבוב bcrypt -> השוואה מאובטחת עם bcrypt.compare
// - אחרת (רשומה ישנה בשפה ברורה) -> השוואה ישירה (תאימות לאחור)
async function comparePassword(plainPassword, storedValue) {
  if (isHashed(storedValue)) {
    return bcrypt.compare(plainPassword, storedValue);
  }
  return plainPassword === storedValue;
}

module.exports = { isHashed, hashPassword, comparePassword };
