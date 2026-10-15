const { google } = require('googleapis');
require('dotenv').config();

// הגדרת אימות OAuth2
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground' // Redirect URI תקני
);

// הגדרת ה-Refresh Token האישי שלך
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

function createSafeDriveError(error, operation) {
  const status = error?.response?.status || error?.status;
  const safeError = new Error(
    `Google Drive ${operation} failed${status ? ` (HTTP ${status})` : ''}`
  );
  safeError.isDriveError = true;
  safeError.code = error?.code;
  safeError.status = status;
  console.error(`שגיאה ב-${operation} מול Google Drive:`, {
    code: safeError.code,
    status: safeError.status,
  });
  return safeError;
}

/**
 * יוצר תיקייה ב-Google Drive ומחזיר את המזהה שלה.
 * אם תיקייה עם אותו שם כבר קיימת תחת האב — מחזיר את המזהה שלה במקום ליצור כפילות.
 * @param {String} name - שם התיקייה
 * @param {String|null} parentId - מזהה תיקיית האב (אופציונלי)
 * @returns {Promise<String>} - מזהה התיקייה
 */
async function getOrCreateFolder(name, parentId = null) {
  const safeName = String(name || '').replace(/'/g, "\\'");
  const parentClause = parentId ? `'${parentId}' in parents and ` : '';
  const query = `mimeType = 'application/vnd.google-apps.folder' and ${parentClause}name = '${safeName}' and trashed = false`;

  try {
    const existing = await drive.files.list({ q: query, fields: 'files(id)', pageSize: 1 });
    if (existing.data.files?.length) return existing.data.files[0].id;

    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId && { parents: [parentId] }),
      },
      fields: 'id',
    });
    return created.data.id;
  } catch (error) {
    throw createSafeDriveError(error, 'יצירת תיקייה');
  }
}

/**
 * העלאת קובץ ל-Google Drive תוך שימוש במכסת האחסון האישית שלך
 * @param {Object} file - קובץ מתוך Multer
 * @param {Object} [options] - אפשרויות העלאה
 * @param {String|null} [options.parentFolderId] - תיקייה יעד ב-Drive (ברירת מחדל: GOOGLE_DRIVE_FOLDER_ID)
 * @param {Boolean} [options.makePublic=true] - האם לשתף את הקובץ בקישור ציבורי.
 *        קבצים אישיים חייבים לעלות עם false כדי שלא ייחשפו למי שאינו הבעלים.
 * @returns {Object} - מזהה הקובץ וקישור לצפייה בו
 */
async function uploadFileToDrive(file, options = {}) {
  const { parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID, makePublic = true } = options;
  try {
    console.log(`מנסה להעלות קובץ ל-Google Drive האישי: ${file.originalname}`);

    const fileMetadata = {
      name: file.originalname,
      ...(parentFolderId && { parents: [String(parentFolderId).trim()] }),
    };

    const media = {
      mimeType: file.mimetype,
      body: require('stream').Readable.from(file.buffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    // קבצים אישיים נשארים פרטיים לחלוטין — אין שיתוף ציבורי.
    if (makePublic) {
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { type: 'anyone', role: 'reader' },
      });
    }

    console.log('הקובץ הועלה בהצלחה לדרייב הפרטי שלך:', response.data.id);
    return response.data;
  } catch (error) {
    throw createSafeDriveError(error, 'העלאת הקובץ');
  }
}

/**
 * מחיקת קובץ מ-Google Drive לפי המזהה שלו.
 * @param {String} fileId - מזהה הקובץ ב-Drive
 */
async function deleteFileFromDrive(fileId) {
  try {
    await drive.files.delete({ fileId });
  } catch (error) {
    throw createSafeDriveError(error, 'מחיקת הקובץ');
  }
}

/**
 * הורדת קובץ מ-Google Drive לפי המזהה שלו, כ-buffer.
 * @param {String} fileId - מזהה הקובץ ב-Drive
 * @returns {Promise<Buffer>}
 */
async function downloadFileFromDrive(fileId) {
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data);
  } catch (error) {
    throw createSafeDriveError(error, 'הורדת הקובץ');
  }
}

module.exports = {
  uploadFileToDrive,
  downloadFileFromDrive,
  deleteFileFromDrive,
  getOrCreateFolder,
};