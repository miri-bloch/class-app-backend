const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

// הגדרת אימות OAuth2 באמצעות פרטי הגישה שלך
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

/**
 * העלאת קובץ ל-Google Drive תוך שימוש במכסת האחסון האישית שלך
 * @param {Object} file - קובץ מתוך Multer
 * @returns {Object} - מזהה הקובץ וקישור לצפייה בו
 */
async function uploadFileToDrive(file) {
  try {
    console.log(`מנסה להעלות קובץ ל-Google Drive האישי: ${file.originalname}`);

    const fileMetadata = {
      name: file.originalname,
      // אם תרצי שהקבצים יגיעו לתיקייה ספציפית, נכניס כאן את ה-ID שלה
      ...(process.env.GOOGLE_FOLDER_ID && {
        parents: [process.env.GOOGLE_FOLDER_ID.trim()],
      }),
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

    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { type: 'anyone', role: 'reader' },
    });

    console.log('הקובץ הועלה בהצלחה לדרייב הפרטי שלך:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('שגיאה בשירות הדרייב (OAuth):', error);
    error.isDriveError = true;
    throw error;
  }
}

module.exports = {
  uploadFileToDrive,
};