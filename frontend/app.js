// קובץ frontend/app.js המעודכן (עם כתובת API יחסית לפריסה ב-Render):
const API_URL = '/api';
let currentUserId = null;
let currentUserName = null;
let currentToken = localStorage.getItem('class_app_token') || null;

// שליחת בקשות עם הטוקן בכותרת Authorization כדי שהשרת יזהה מי באמת מחוברת
async function authFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (currentToken) headers.set('Authorization', `Bearer ${currentToken}`);
  return fetch(url, { ...options, headers });
}

const loginSection = document.getElementById('login-section');
const registerSection = document.getElementById('register-section');
const authContainer = document.getElementById('auth-container');
const dashboardApp = document.getElementById('dashboard-app');

document.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('class_app_user');
  const savedTime = localStorage.getItem('class_app_time');
  
  if (savedUser && savedTime) {
    const twoWeeks = 14 * 24 * 60 * 60 * 1000;
    if (Date.now() - parseInt(savedTime) < twoWeeks) {
      const userObj = JSON.parse(savedUser);
      currentUserId = userObj.id;
      currentUserName = userObj.full_name;
      initDashboard(userObj.full_name, userObj.email);
    } else {
      localStorage.removeItem('class_app_user');
      localStorage.removeItem('class_app_time');
    }
  }
});

function saveSession(user, token) {
  currentUserId = user.id;
  currentUserName = user.full_name;
  localStorage.setItem('class_app_user', JSON.stringify(user));
  localStorage.setItem('class_app_time', Date.now().toString());
  // שמירת הטוקן כדי שפעולות מאובטחות (שליחת קבצים למייל, ניהול תור החלב) יצליחו.
  if (token) {
    currentToken = token;
    localStorage.setItem('class_app_token', token);
  }
  initDashboard(user.full_name, user.email);
}

function logoutSession() {
  localStorage.removeItem('class_app_user');
  localStorage.removeItem('class_app_time');
  localStorage.removeItem('class_app_token');
  currentToken = null;
  currentUserId = null;
  dashboardApp.style.display = 'none';
  document.getElementById('user-profile-header').style.display = 'none';
  authContainer.style.display = 'block';
  document.getElementById('login-form').reset();
  showToast('התנתקת מהמערכת בהצלחה');
}

document.getElementById('show-register-btn').addEventListener('click', () => {
  loginSection.style.display = 'none';
  registerSection.style.display = 'block';
});
document.getElementById('show-login-btn').addEventListener('click', () => {
  registerSection.style.display = 'none';
  loginSection.style.display = 'block';
});

function setGreetingBanner(userName) {
  const hour = new Date().getHours();
  let greeting = 'שלום רב';
  if (hour >= 5 && hour < 12) greeting = `בוקר טוב, ${userName} ☕`;
  else if (hour >= 12 && hour < 17) greeting = `צהריים טובים, ${userName} ☀️`;
  else if (hour >= 17 && hour < 21) greeting = `ערב טוב, ${userName} 🌆`;
  else greeting = `לילה טוב, ${userName} 🌙`;

  document.getElementById('greeting-banner').textContent = greeting;
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast-notification');
  toast.textContent = message;
  toast.className = isError ? 'error show' : 'show';
  
  setTimeout(() => {
    toast.className = '';
  }, 3500);
}

function setButtonLoading(button, loadingText) {
  if (!button) return () => {};
  const originalText = button.textContent;
  button.disabled = true;
  button.classList.add('is-loading');
  button.textContent = loadingText;
  return () => {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.textContent = originalText;
  };
}

function normalizeAttachmentName(filename) {
  if (!filename) return 'פתיחת קובץ';
  try {
    const bytes = new Uint8Array([...filename].map(character => character.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\u0590-\u05FF]/.test(decoded) ? decoded : filename;
  } catch (error) {
    return filename;
  }
}

function parseLocalDate(dateValue) {
  if (!dateValue) return new Date(NaN);
  if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month, day] = dateValue.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(dateValue);
}

function getDateKey(dateValue) {
  const date = dateValue instanceof Date ? dateValue : parseLocalDate(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeSubjectName(subject) {
  return String(subject || '')
    .normalize('NFKC')
    .replace(/[׳’`]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const full_name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const msg = document.getElementById('register-message');

  try {
    const res = await authFetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, password })
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = 'ההרשמה הצליחה!';
      msg.style.color = 'var(--neon-cyan)';
      setTimeout(() => saveSession(data.user, data.token), 1000);
    } else {
      msg.textContent = data.error || 'שגיאה בהרשמה';
      msg.style.color = '#f43f5e';
    }
  } catch (err) {
    msg.textContent = 'תקלת תקשורת';
    msg.style.color = '#f43f5e';
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const msg = document.getElementById('login-message');

  try {
    const res = await authFetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = 'התחברת בהצלחה!';
      msg.style.color = 'var(--neon-cyan)';
      setTimeout(() => saveSession(data.user, data.token), 1000);
    } else {
      msg.textContent = data.error || 'שגיאה בהתחברות';
      msg.style.color = '#f43f5e';
    }
  } catch (err) {
    msg.textContent = 'תקלת תקשורת';
    msg.style.color = '#f43f5e';
  }
});

function initDashboard(userName, email) {
  authContainer.style.display = 'none';
  dashboardApp.style.display = 'block';
  
  document.getElementById('user-profile-header').style.display = 'flex';
  document.getElementById('user-profile-name').textContent = userName;
  document.getElementById('user-avatar-circle').textContent = userName ? userName.charAt(0).toUpperCase() : 'U';

  setGreetingBanner(userName);
  loadNotices();
  loadAssignments();
  loadAssignmentStats();
  loadMilkRotation();
  loadShvabimSchedule();
  loadWeeklyCalendar();
  loadEmailPreference();
}

async function loadEmailPreference() {
  const toggle = document.getElementById('daily-email-toggle');
  if (!toggle || !currentUserId) return;

  try {
    const response = await authFetch(`${API_URL}/auth/notification-settings/${currentUserId}`);
    if (response.ok) {
      const settings = await response.json();
      toggle.checked = settings.email_notifications;
    }
  } catch (error) {
    showToast('לא הצלחנו לטעון את העדפת המייל', true);
  }
}

async function updateEmailPreference(enabled) {
  if (!currentUserId) return;
  const toggle = document.getElementById('daily-email-toggle');

  try {
    const response = await authFetch(`${API_URL}/auth/notification-settings/${currentUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_notifications: enabled })
    });

    if (!response.ok) throw new Error('Preference update failed');
    showToast(enabled ? 'המייל היומי הופעל' : 'המייל היומי בוטל');
  } catch (error) {
    if (toggle) toggle.checked = !enabled;
    showToast('לא הצלחנו לשמור את העדפת המייל', true);
  }
}

setInterval(async () => {
  if (!currentUserId) return;
  try {
    const res = await authFetch(`${API_URL}/auth/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUserId })
    });
    const data = await res.json();
    const badge = document.getElementById('online-count');
    if (badge && data.onlineCount) {
      badge.textContent = data.onlineCount;
    }
  } catch (err) {}
}, 30000);

document.getElementById('notice-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('notice-title').value;
  const content = document.getElementById('notice-content').value;
  const restoreButton = setButtonLoading(e.currentTarget.querySelector('button[type="submit"]'), 'שולחת מייל...');
  showToast('המודעה נשמרת והמייל נשלח, נא להמתין...');

  try {
    const res = await authFetch(`${API_URL}/notices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author_id: currentUserId, title, content, is_important: true })
    });
    if (res.ok) {
      showToast('המודעה פורסמה ונשלח מייל אוטומטי לכולן!');
      document.getElementById('notice-form').reset();
      loadNotices();
    }
  } catch (err) {
    showToast('שגיאה בפרסום המודעה', true);
  } finally {
    restoreButton();
  }
});

async function loadNotices() {
  const list = document.getElementById('notices-list');
  try {
    const res = await authFetch(`${API_URL}/notices`);
    const notices = await res.json();
    list.innerHTML = notices.length ? '' : '<div style="color:var(--text-muted)">אין מודעות.</div>';
    notices.forEach(n => {
      list.innerHTML += `
        <div class="assignment-card" style="border-right-color: #f43f5e; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div class="assignment-title">${n.title}</div>
            <button onclick="deleteNotice(${n.id})" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.8rem; padding:0;" title="מחק הודעה">✕ מחיקה</button>
          </div>
          <div style="font-size:0.9rem; margin-top:4px;">${n.content}</div>
          <div class="assignment-date" style="margin-top:6px;">מאת: ${n.author_name || 'כיתה'}</div>
        </div>`;
    });
  } catch (err) { list.innerHTML = 'שגיאה בטעינת מודעות'; }
}

async function deleteNotice(noticeId) {
  if (!await showCustomConfirm('מחיקת הודעה', 'האם את בטוחה שברצונך למחוק הודעה זו?')) return;
  try {
    const res = await authFetch(`${API_URL}/notices/${noticeId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('ההודעה נמחקה בהצלחה');
      loadNotices();
    } else {
      showToast('שגיאה במחיקת ההודעה', true);
    }
  } catch (err) {
    showToast('תקלת תקשורת מול השרת', true);
  }
}

async function loadAssignments() {
  const list = document.getElementById('assignments-list');
  const summary = document.getElementById('assignments-summary');
  const showHiddenButton = document.getElementById('show-hidden-assignments');
  const hiddenStorageKey = `hidden_assignments_${currentUserId}`;
  const hiddenAssignments = new Set(JSON.parse(localStorage.getItem(hiddenStorageKey) || '[]'));
  let showHidden = false;

  const renderAssignments = (assignments) => {
    const today = parseLocalDate(getDateKey(new Date()));
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 2);
    const visibleAssignments = assignments.filter(a => {
      if (showHidden) return true;
      return !hiddenAssignments.has(String(a.id));
    });

    if (summary) summary.textContent = `${visibleAssignments.length} מטלות מוצגות`;
    if (showHiddenButton) {
      const hiddenCount = assignments.filter(a => hiddenAssignments.has(String(a.id))).length;
      showHiddenButton.style.display = hiddenCount > 0 ? 'inline-flex' : 'none';
      showHiddenButton.textContent = showHidden ? 'הסתירי את המוסתרות' : `הציגי ${hiddenCount} מטלות שהוסתרו`;
    }
    list.innerHTML = visibleAssignments.length ? '' : '<div class="empty-state">אין מטלות להצגה.</div>';

    visibleAssignments.forEach(a => {
      const isChecked = a.is_completed ? 'checked' : '';
      const compCount = parseInt(a.completed_count) || 0;
      const totUsers = parseInt(a.total_users) || 1;
      const classPct = Math.round((compCount / totUsers) * 100);
      const dateObj = parseLocalDate(a.due_date);
      const gregorianDate = dateObj.toLocaleDateString('he-IL');
      const canHide = dateObj < today && Boolean(a.is_completed);
      let hebrewDate = '';

      try {
        const formatter = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long' });
        hebrewDate = formatter.format(dateObj);
      } catch (e) {
        hebrewDate = '';
      }

      list.innerHTML += `
        <div class="assignment-card assignment-item ${canHide ? 'assignment-old' : ''}" id="assignment-${a.id}">
          <div class="assignment-card-header">
            <div>
              <div class="assignment-subject">${a.subject}</div>
              <div class="assignment-title">${a.title}</div>
            </div>
            <div class="assignment-actions">
              ${hiddenAssignments.has(String(a.id))
                ? `<button onclick="unhideAssignment(${a.id})" class="assignment-hide" title="בטלי את ההסתרה של המטלה" aria-label="בטלי הסתרה">🙈</button>`
                : (canHide ? `<button onclick="hideAssignment(${a.id})" class="assignment-hide" title="הסתרי מטלה שבוצעה" aria-label="הסתרי מטלה שבוצעה">👁</button>` : '')}
              <button onclick="deleteAssignment(${a.id})" class="assignment-delete" title="מחק מטלה">✕</button>
            </div>
          </div>
          <div class="assignment-date">הגשה: ${gregorianDate} ${hebrewDate ? '(' + hebrewDate + ')' : ''}</div>
          <div class="assignment-class-stats">
            <span class="assignment-stats-label">ביצוע בכיתה: ${compCount}/${totUsers} (${classPct}%)</span>
            <div class="assignment-stats-bar">
              <div class="assignment-stats-fill" style="width:${classPct}%"></div>
            </div>
          </div>
          ${a.drive_file_id ? `<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">
            <a href="${a.drive_web_view_link || `https://drive.google.com/file/d/${a.drive_file_id}/view`}" target="_blank" rel="noopener" class="neon-btn outline" style="width:auto; padding:5px 9px; font-size:0.78rem; text-decoration:none;">📎 ${normalizeAttachmentName(a.attachment_name)}</a>
            <a href="https://drive.google.com/uc?export=download&id=${a.drive_file_id}" target="_blank" rel="noopener" class="neon-btn outline" style="width:auto; padding:5px 9px; font-size:0.78rem; text-decoration:none;">הורדה</a>
            <button onclick="sendAssignmentToEmail(${a.id})" class="neon-btn outline" style="width:auto; padding:5px 9px; font-size:0.78rem;">שלחי לי למייל 📧</button>
          </div>` : ''}
          <label class="assignment-complete">
            <input type="checkbox" class="complete-checkbox custom-checkbox" ${isChecked} onchange="toggleAssignment(${a.id}, this.checked)"> בוצע ✓
          </label>
        </div>`;
    });
  };

  try {
    const res = await authFetch(`${API_URL}/assignments?userId=${currentUserId}`);
    const assignments = await res.json();
    renderAssignments(assignments);
    if (showHiddenButton) {
      showHiddenButton.onclick = () => {
        showHidden = !showHidden;
        renderAssignments(assignments);
      };
    }
  } catch (err) { list.innerHTML = '<div class="empty-state">שגיאה בטעינת מטלות</div>'; }
}

function hideAssignment(assignmentId) {
  const hiddenStorageKey = `hidden_assignments_${currentUserId}`;
  const hiddenAssignments = new Set(JSON.parse(localStorage.getItem(hiddenStorageKey) || '[]'));
  hiddenAssignments.add(String(assignmentId));
  localStorage.setItem(hiddenStorageKey, JSON.stringify([...hiddenAssignments]));
  loadAssignments();
}

function unhideAssignment(assignmentId) {
  const hiddenStorageKey = `hidden_assignments_${currentUserId}`;
  const hiddenAssignments = new Set(JSON.parse(localStorage.getItem(hiddenStorageKey) || '[]'));
  hiddenAssignments.delete(String(assignmentId));
  localStorage.setItem(hiddenStorageKey, JSON.stringify([...hiddenAssignments]));
  loadAssignments();
}

async function deleteAssignment(assignmentId) {
  if (!await showCustomConfirm('מחיקת מטלה', 'האם את בטוחה שברצונך למחוק מטלה זו?')) return;

  try {
    const res = await authFetch(`${API_URL}/assignments/${assignmentId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('המטלה נמחקה בהצלחה');
      loadAssignments();
      loadWeeklyCalendar();
    } else {
      showToast('שגיאה במחיקת המטלה', true);
    }
  } catch (err) {
    showToast('תקלת תקשורת מול השרת', true);
  }
}

document.getElementById('add-assignment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const subject = document.getElementById('new-assignment-subject').value;
  const title = document.getElementById('new-assignment-title').value;
  const due_date = document.getElementById('new-assignment-date').value;
  const attachment = document.getElementById('new-assignment-attachment').files[0];
  const restoreButton = setButtonLoading(e.currentTarget.querySelector('button[type="submit"]'), 'שומרת...');

  try {
    const formData = new FormData();
    formData.append('subject', subject);
    formData.append('title', title);
    formData.append('due_date', due_date);
    formData.append('difficulty_level', '3');
    if (attachment) formData.append('attachment', attachment);

    const res = await authFetch(`${API_URL}/assignments`, {
      method: 'POST',
      body: formData
    });
    if (res.ok) {
      document.getElementById('add-assignment-form').reset();
      loadAssignments();
      loadAssignmentStats();
      loadWeeklyCalendar();
      loadShvabimSchedule();
      showToast('המטלה נוספה בהצלחה!');
    }
  } catch (err) {
    showToast('שגיאה בהוספת המטלה', true);
  } finally {
    restoreButton();
  }
});

async function toggleAssignment(id, isCompleted) {
  const response = await authFetch(`${API_URL}/assignments/${id}/note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: currentUserId, is_completed: isCompleted, note_text: '' })
  });
  if (!response.ok) {
    showToast('שגיאה בעדכון ביצוע המטלה', true);
    return;
  }
  loadAssignments();
  loadAssignmentStats();
}

async function sendAssignmentToEmail(assignmentId) {
  try {
    const res = await authFetch(`${API_URL}/assignments/${assignmentId}/send-to-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'שגיאה בשליחת הקובץ', true);
      return;
    }
    showToast(data.message || 'הקובץ נשלח בהצלחה למייל שלך!');
  } catch (err) {
    showToast('תקלת תקשורת מול השרת', true);
  }
}

async function loadAssignmentStats() {
  const statsList = document.getElementById('stats-list');
  try {
    const res = await authFetch(`${API_URL}/assignments/stats/completion`);
    const stats = await res.json();
    statsList.innerHTML = '';
    stats.forEach(s => {
      const comp = parseInt(s.completed_count) || 0;
      const total = parseInt(s.total_users) || 1;
      const pct = Math.round((comp / total) * 100);
      statsList.innerHTML += `
        <div class="assignment-card">
          <div class="assignment-subject">${s.subject || 'כללי'}</div>
          <div class="assignment-title" style="font-size:0.9rem;">${s.title}</div>
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">השלימו: ${comp}/${total} (${pct}%)</div>
          <div style="background:rgba(255,255,255,0.1); height:6px; border-radius:3px; margin-top:6px; overflow:hidden;">
            <div style="background:var(--neon-cyan); width:${pct}%; height:100%;"></div>
          </div>
        </div>`;
    });
  } catch (err) {}
}

async function loadShvabimSchedule() {
  const grid = document.getElementById('shvabim-schedule-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const scheduleData = [
    {
      day: 'יום ראשון',
      lessons: [
        { time: '13:05 - 14:40', subject: 'full stack - angular' },
        { time: '15:20 - 16:10', subject: 'ארגון המחשב' }
      ]
    },
    {
      day: 'יום שני',
      lessons: [
        { time: '08:45 - 10:35', subject: 'מבני נתונים' },
        { time: '10:45 - 13:05', subject: 'תכנות מתקדם עם C#' },
        { time: '13:05 - 15:20', subject: 'מערכות הפעלה' }
      ]
    },
    {
      day: 'יום שלישי',
      lessons: [
        { time: '08:00 - 10:35', subject: 'core' },
        { time: '10:45 - 13:50', subject: 'תכנות מתקדם עם ג׳אווה' },
        { time: '14:00 - 15:20', subject: 'מבני נתונים' },
        { time: '17:30 - 19:30', subject: 'פייתון' },
        { time: '19:40 - 21:00', subject: 'unit test & qa' }
      ]
    },
    {
      day: 'יום רביעי',
      lessons: [
        { time: '12:20 - 13:50', subject: 'תקשורת נתונים ואבטחת מידע' },
        { time: '14:00 - 15:20', subject: 'לינוקס' },
        { time: '20:00 - 21:20', subject: 'full stack - react' },
        { time: 'מתוקשב', subject: 'node.js' }
      ]
    },
    {
      day: 'יום חמישי',
      lessons: [
        { time: '13:05 - 16:10', subject: 'עקרונות פיתוח עם AI וחדשנות' }
      ]
    },
    {
      day: 'יום שישי',
      lessons: [
        { time: '10:05 - 11:20', subject: 'מבני נתונים' }
      ]
    }
  ];

  scheduleData.forEach(d => {
    let lessonsHtml = d.lessons.map(l => `
      <div onclick="showSubjectAssignments('${l.subject}')" style="background: rgba(34,211,238,0.12); border-right: 3px solid var(--neon-cyan); padding: 8px; border-radius: 6px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(34,211,238,0.25)'" onmouseout="this.style.background='rgba(34,211,238,0.12)'">
        <div style="font-size: 0.75rem; color: var(--text-muted); direction: ltr; text-align: right;">${l.time}</div>
        <div style="font-size: 0.9rem; font-weight: bold; color: var(--neon-cyan); margin-top: 3px;">📚 ${l.subject}</div>
      </div>
    `).join('');

    grid.innerHTML += `
      <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 12px; min-height: 200px; display: flex; flex-direction: column;">
        <div style="font-weight: bold; color: var(--neon-cyan); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 10px; font-size: 0.95rem; text-align: center;">
          ${d.day}
        </div>
        <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 8px;">
          ${lessonsHtml}
        </div>
      </div>`;
  });

}

async function showSubjectAssignments(subjectName) {
  try {
    const res = await authFetch(`${API_URL}/assignments?userId=${currentUserId}`);
    if (!res.ok) return;
    const assignments = await res.json();

    const today = parseLocalDate(getDateKey(new Date()));
    const hiddenStorageKey = `hidden_assignments_${currentUserId}`;
    const hiddenAssignments = new Set(JSON.parse(localStorage.getItem(hiddenStorageKey) || '[]'));

    const subjectAssignments = assignments.filter(a => {
      if (!a.subject || !a.due_date) return false;
      if (normalizeSubjectName(a.subject) !== normalizeSubjectName(subjectName)) return false;
      if (hiddenAssignments.has(String(a.id))) return false;
      return true;
    });

    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const descEl = document.getElementById('modal-desc');
    const inputContainer = document.getElementById('modal-input-container');
    const submitBtn = document.getElementById('modal-submit-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    titleEl.textContent = `מטלות במקצוע: ${subjectName}`;
    inputContainer.style.display = 'none';
    submitBtn.style.display = 'none';
    cancelBtn.textContent = 'סגור';

    if (subjectAssignments.length === 0) {
      descEl.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">אין מטלות במקצוע ${subjectName}.</p>`;
    } else {
      let html = `<div style="display: flex; flex-direction: column; gap: 10px; text-align: right;">`;
      subjectAssignments.forEach(a => {
        const gregorianDate = parseLocalDate(a.due_date).toLocaleDateString('he-IL');
        const completedLabel = a.is_completed ? 'בוצע ✓' : 'טרם בוצע';
        html += `
          <div style="background: rgba(0,0,0,0.4); border-right: 4px solid var(--neon-cyan); padding: 10px; border-radius: 6px;">
            <div style="font-weight: bold; color: white; font-size: 0.95rem;">${a.title}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">תאריך הגשה: ${gregorianDate} · ${completedLabel}</div>
          </div>`;
      });
      html += `</div>`;
      descEl.innerHTML = html;
    }

    modal.style.display = 'flex';

    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });

  } catch (err) {
    showToast('שגיאה בטעינת מטלות למקצוע', true);
  }
}

async function loadMilkRotation() {
  try {
    const res = await authFetch(`${API_URL}/milk`);
    const data = await res.json();

    const current = data.current;
    const upcoming = data.upcoming || [];

    const currentPersonEl = document.getElementById('current-milk-person');
    const fulfillContainer = document.getElementById('fulfill-milk-container');
    const notYourTurnMsg = document.getElementById('not-your-turn-msg');

    if (!current) {
      if (currentPersonEl) currentPersonEl.textContent = 'אין סדר תור מוגדר עדיין';
      if (fulfillContainer) fulfillContainer.style.display = 'none';
      if (notYourTurnMsg) notYourTurnMsg.style.display = 'none';
      const upcomingContainer = document.getElementById('upcoming-milk-queue');
      if (upcomingContainer) upcomingContainer.innerHTML = '';
      return;
    }

    if (currentPersonEl) currentPersonEl.textContent = current.full_name;

    if (data.is_mine) {
      if (fulfillContainer) fulfillContainer.style.display = 'block';
      if (notYourTurnMsg) notYourTurnMsg.style.display = 'none';
    } else {
      if (fulfillContainer) fulfillContainer.style.display = 'none';
      if (notYourTurnMsg) notYourTurnMsg.style.display = 'block';
    }

    let upcomingContainer = document.getElementById('upcoming-milk-queue');
    if (!upcomingContainer) {
      upcomingContainer = document.createElement('div');
      upcomingContainer.id = 'upcoming-milk-queue';
      document.getElementById('current-milk-person').parentNode.appendChild(upcomingContainer);
    }

    if (upcoming.length > 0) {
      upcomingContainer.innerHTML = `
        <div style="margin-top: 12px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px; font-size: 0.8rem; color: var(--text-muted);">
          <span style="font-weight: 500;">הבאות בתור:</span> ${upcoming.map(u => u.full_name).join(' ➔ ')}
        </div>
      `;
    } else {
      upcomingContainer.innerHTML = '';
    }
  } catch (err) {
    const el = document.getElementById('current-milk-person');
    if (el) el.textContent = 'שגיאה בטעינת נתוני תורנות';
  }
}

async function fulfillMilkDuty() {
  const button = document.querySelector('button[onclick="fulfillMilkDuty()"]');
  const restoreButton = setButtonLoading(button, 'שולחת מייל...');
  try {
    const res = await authFetch(`${API_URL}/milk/advance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.error || 'שגיאה בקידום התור', true);
      return;
    }

    showToast('התורנות הסתיימה! התור עבר אוטומטית לבת הבאה.');
    loadMilkRotation();
  } catch (err) {
    showToast('שגיאה בעדכון התורנות', true);
  } finally {
    restoreButton();
  }
}

async function advanceMilkDutyForAdmin() {
  const confirmed = await showCustomConfirm('קידום תור החלב', 'האם לקדם את התורנית הנוכחית ולהודיע לבאה בתור במייל?');
  if (!confirmed) return;

  const button = document.querySelector('button[onclick="advanceMilkDutyForAdmin()"]');
  const restoreButton = setButtonLoading(button, 'מקדמת תור...');

  try {
    const advanceResponse = await authFetch(`${API_URL}/milk/advance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!advanceResponse.ok) {
      const errData = await advanceResponse.json().catch(() => ({}));
      showToast(errData.error || 'שגיאה בקידום התור', true);
      return;
    }

    showToast('התור קודם בהצלחה ונשלחה הודעה לבאה בתור!');
    loadMilkRotation();
  } catch (err) {
    showToast('שגיאה בקידום תור החלב', true);
  } finally {
    restoreButton();
  }
}

// מצב הסדר הנוכחי (רשימת user_id לפי הסדר) באזור הניהול.
let currentMilkRotationUserIds = [];
const milkNameMap = {}; // id -> full_name לצורך תצוגה נוחה.

async function loadMilkRotationAdmin() {
  const listEl = document.getElementById('milk-rotation-admin-list');
  if (!listEl) return;

  try {
    const res = await authFetch(`${API_URL}/milk`);
    const data = await res.json();
    currentMilkRotationUserIds = (data.rotation || []).map(r => r.user_id);
    (data.rotation || []).forEach(r => { milkNameMap[r.user_id] = r.full_name; });

    renderMilkRotationAdminList();
    refreshMilkSelect();
  } catch (err) {
    listEl.innerHTML = '<div style="color:#f43f5e;">שגיאה בטעינת סדר התור</div>';
  }
}

// מציגה את הסדר הנוכחי עם חצים להזזה וכפתור מחיקה לכל שורה.
function renderMilkRotationAdminList() {
  const listEl = document.getElementById('milk-rotation-admin-list');
  if (!listEl) return;

  if (currentMilkRotationUserIds.length === 0) {
    listEl.innerHTML = '<div style="color:var(--text-muted);">עדיין אין סדר מוגדר.</div>';
    return;
  }

  listEl.innerHTML = currentMilkRotationUserIds.map((uid, i) => `
    <div style="display:flex; align-items:center; gap:6px; padding:4px 0; border-bottom: 1px dashed rgba(255,255,255,0.08);">
      <span style="flex:1; ${i === 0 ? 'color: var(--neon-cyan); font-weight: bold;' : ''}">${i + 1}. ${milkNameMap[uid] || ('#' + uid)}${i === 0 ? ' 👑' : ''}</span>
      <button onclick="moveMilkRotation(${i}, -1)" title="העליי למעלה" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:#cbd5e1; border-radius:4px; padding:2px 7px; font-size:0.75rem; cursor:pointer;">↑</button>
      <button onclick="moveMilkRotation(${i}, 1)" title="הורידי למטה" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:#cbd5e1; border-radius:4px; padding:2px 7px; font-size:0.75rem; cursor:pointer;">↓</button>
      <button onclick="removeFromMilkRotation(${i})" title="הסירי מהתור" style="background:rgba(244,63,94,0.1); border:1px solid rgba(244,63,94,0.3); color:#f43f5e; border-radius:4px; padding:2px 7px; font-size:0.75rem; cursor:pointer;">✕</button>
    </div>`).join('');
}

// מעדכנת את רשימת המשתמשות ב-select כך שהנוכחיות לא יופיעו פעמיים.
function refreshMilkSelect() {
  const selectEl = document.getElementById('milk-rotation-add-select');
  if (!selectEl) return;
  authFetch(`${API_URL}/auth/users`)
    .then(r => (r.ok ? r.json() : []))
    .then(users => {
      selectEl.innerHTML = '<option value="">בחרי משתמשת...</option>';
      users.forEach(u => {
        if (!currentMilkRotationUserIds.includes(u.id)) {
          selectEl.innerHTML += `<option value="${u.id}">${u.full_name}</option>`;
        }
      });
    })
    .catch(() => {});
}

// הזזת משתמשת למעלה (dir=-1) או למטה (dir=1) בסדר התור.
function moveMilkRotation(index, dir) {
  const target = index + dir;
  if (target < 0 || target >= currentMilkRotationUserIds.length) return;
  const tmp = currentMilkRotationUserIds[index];
  currentMilkRotationUserIds[index] = currentMilkRotationUserIds[target];
  currentMilkRotationUserIds[target] = tmp;
  renderMilkRotationAdminList();
}

// מחיקת משתמשת מהתור.
function removeFromMilkRotation(index) {
  if (index < 0 || index >= currentMilkRotationUserIds.length) return;
  currentMilkRotationUserIds.splice(index, 1);
  renderMilkRotationAdminList();
  refreshMilkSelect();
}

// טעינת תור ברירת מחדל: חני, שבי מאיר, טובי קלרמן, ריקי פקמן, מירי בלוך.
function loadDefaultMilkRotation() {
  currentMilkRotationUserIds = [9, 15, 11, 10, 13]; // חני, שבי מאיר, טובי קלרמן, ריקי פקמן, מירי בלוך
  renderMilkRotationAdminList();
  refreshMilkSelect();
  showToast('תור ברירת המחדל נטען — לחצי על "שמרי" שייכנס לתוקף');
}

function addToMilkRotation() {
  const selectEl = document.getElementById('milk-rotation-add-select');
  if (!selectEl || !selectEl.value) {
    showToast('יש לבחור משתמשת להוספה', true);
    return;
  }
  const uid = Number(selectEl.value);
  if (currentMilkRotationUserIds.includes(uid)) return;
  currentMilkRotationUserIds.push(uid);
  renderMilkRotationAdminList();
  refreshMilkSelect();
}

async function saveMilkRotation() {
  if (currentMilkRotationUserIds.length === 0) {
    showToast('התור ריק — אין מה לשמור', true);
    return;
  }
  try {
    const res = await authFetch(`${API_URL}/milk/rotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: currentMilkRotationUserIds })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'שגיאה בשמירת הסדר');
    showToast('סדר התור נשמר בהצלחה!');
    loadMilkRotationAdmin();
    loadMilkRotation();
  } catch (err) {
    showToast(err.message || 'שגיאה בשמירת הסדר', true);
  }
}

let weekOffset = 0;

function getWeekDates(offset = 0) {
  const now = new Date();
  const currentDay = now.getDay();
  const firstDayOfWeek = new Date(now);
  firstDayOfWeek.setDate(now.getDate() - currentDay + (offset * 7));

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(firstDayOfWeek);
    day.setDate(firstDayOfWeek.getDate() + i);
    weekDates.push(day);
  }
  return weekDates;
}

function changeWeek(direction) {
  weekOffset += direction;
  loadWeeklyCalendar();
}

async function loadWeeklyCalendar() {
  const grid = document.getElementById('weekly-calendar-grid');
  const label = document.getElementById('current-week-label');
  if (!grid) return;
  grid.innerHTML = '';

  const weekDays = getWeekDates(weekOffset);
  const startStr = weekDays[0].toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  const endStr = weekDays[6].toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  if (label) label.textContent = `שבוע: ${startStr} - ${endStr}`;

  let events = JSON.parse(localStorage.getItem('class_events')) || [];

  // טעינת האירועים המשותפים מהשרת (מופיעים לכולם, לא אישיים)
  try {
    const eventsRes = await authFetch(`${API_URL}/events`);
    if (eventsRes.ok) {
      const sharedEvents = await eventsRes.json();
      // ממירים event_date לפורמט date אחיד אצל ה-frontend
      events = sharedEvents.map(ev => ({ id: ev.id, title: ev.title, date: ev.event_date, created_by_name: ev.created_by_name, confirm_count: ev.confirm_count }));
    }
  } catch (err) {
    console.error('שגיאה בטעינת אירועים משותפים:', err);
  }

  let assignments = [];
  try {
    if (currentUserId) {
      const res = await authFetch(`${API_URL}/assignments?userId=${currentUserId}`);
      if (res.ok) assignments = await res.json();
    }
  } catch (err) {}

const todayStr = getDateKey(new Date());

  weekDays.forEach(day => {
    const dateString = getDateKey(day);
    const dayName = day.toLocaleDateString('he-IL', { weekday: 'long' });
    const formattedDate = day.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
    
    let hebrewDateStr = '';
    try {
      const formatter = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long' });
      hebrewDateStr = formatter.format(day);
    } catch (e) {
      hebrewDateStr = '';
    }

    const dayEvents = events.filter(e => e.date === dateString);
    const dayAssignments = assignments.filter(a => {
      if (!a.due_date) return false;
      return getDateKey(parseLocalDate(a.due_date)) === dateString;
    });

    const isToday = (dateString === todayStr);
    
    const cardStyle = isToday 
      ? 'background: rgba(0,0,0,0.5); border: 2px solid var(--neon-cyan); box-shadow: 0 0 15px rgba(34,211,238,0.4); border-radius: 10px; padding: 14px; min-height: 220px; display: flex; flex-direction: column;'
      : 'background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; min-height: 220px; display: flex; flex-direction: column;';

    grid.innerHTML += `
      <div style="${cardStyle}">
        <div style="font-weight: bold; color: var(--neon-cyan); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 8px; font-size: 0.95rem; display: flex; justify-content: space-between; align-items: center;">
          <span>${dayName}</span>
          ${isToday ? '<span style="font-size: 0.7rem; background: var(--neon-cyan); color: #050508; padding: 2px 6px; border-radius: 4px; font-weight: bold;">היום</span>' : ''}
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px;">
          ${formattedDate} ${hebrewDateStr ? '| ' + hebrewDateStr : ''}
        </div>
        <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 6px;">
          ${dayAssignments.map(a => `
            <div style="background: rgba(34,211,238,0.15); border-right: 3px solid var(--neon-cyan); padding: 5px 8px; border-radius: 4px; font-size: 0.8rem;">
              <span style="color: var(--neon-cyan); font-weight: bold;">📚 ${a.subject}:</span> <span>${a.title}</span>
            </div>`).join('')}
          ${dayEvents.map(e => `
            <div style="background: rgba(168,85,247,0.15); border-right: 3px solid var(--neon-purple); padding: 5px 8px; border-radius: 4px; font-size: 0.8rem; display:flex; justify-content:space-between; align-items:center; gap:6px;">
              <span style="flex:1;">📌 ${e.title}${e.created_by_name || e.confirm_count ? ` <span style="color:var(--text-muted); font-size:0.7rem;">${e.created_by_name ? 'הוסיפה: ' + e.created_by_name : ''}${e.confirm_count ? (e.created_by_name ? ' • ' : '') + e.confirm_count + ' בנות' : ''}</span>` : ''}</span>
              <button onclick="deleteEvent(${e.id})" title="מחיקה לכולם" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.75rem; padding:0; flex-shrink:0;">✕</button>
            </div>`).join('')}
          ${!dayAssignments.length && !dayEvents.length ? '<span style="color: var(--text-muted); font-size: 0.75rem; text-align: center; margin-top: auto; margin-bottom: auto;">אין אירועים או מטלות</span>' : ''}
        </div>
      </div>`;
  });
}

const calendarForm = document.getElementById('calendar-event-form');
if (calendarForm) {
  calendarForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('event-title').value;
    const date = document.getElementById('event-date').value;

    try {
      const res = await authFetch(`${API_URL}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          event_date: date,
          userId: currentUserId || null,
          userName: currentUserName || 'משתמשת'
        })
      });

      if (res.status === 409) {
        // אירוע דומה כבר קיים — מניעת כפילויות חכמה: מציעים להצטרף במקום להוסיף כפילות
        const dupData = await res.json().catch(() => ({}));
        const existing = dupData.existingEvent;
        if (existing) {
          const ok = await showCustomConfirm(
            'האירוע כבר קיים!',
            `לאירוע "${existing.title}" כבר יש ${existing.confirm_count} בנות. כדי לא ליצור כפילות, את רוצה להצטרף אליו במקום?`,
            'מצטרפת',
            'ביטול'
          );
          if (ok) {
            const confirmRes = await authFetch(`${API_URL}/events/${existing.id}/confirm`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: currentUserId || null })
            });
            if (confirmRes.ok) {
              calendarForm.reset();
              await loadWeeklyCalendar();
              showToast('נצטרפת לאירוע! עכשיו גם את חלק מזה.');
            }
          } else {
            calendarForm.reset();
          }
        }
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'שגיאה בהוספת האירוע');
      }

      // מנקים אירוע מקומי ישן בעל אותו שם ותאריך אם נשאר מה-localStorage
      let localCalendarEvents = JSON.parse(localStorage.getItem('class_events')) || [];
      localCalendarEvents = localCalendarEvents.filter(ev => !(ev.title === title && ev.date === date));
      localStorage.setItem('class_events', JSON.stringify(localCalendarEvents));

      calendarForm.reset();
      await loadWeeklyCalendar();
      showToast('האירוע נוסף לכולם בלוח השנה!');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'שגיאה בהוספת האירוע');
    }
  });
}

async function deleteEvent(id) {
  // מאחר והמחיקה משפיעה על כל הבנות — מבקשים אישור לפני שממשיכים
  const ok = await showCustomConfirm(
    'מחיקת אירוע לכולם',
    'האירוע הזה מופיע אצל כל הבנות בכיתה. למחוק אותו לכולם?',
    'כן, מחקי לכולם',
    'ביטול'
  );
  if (!ok) return;

  try {
    const res = await authFetch(`${API_URL}/events/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'שגיאה במחיקת האירוע');
    }
    // ניקוי מ-localStorage אם האירוע היה שם מפעם
    let localCalendarEvents = JSON.parse(localStorage.getItem('class_events')) || [];
    localCalendarEvents = localCalendarEvents.filter(ev => ev.id !== id);
    localStorage.setItem('class_events', JSON.stringify(localCalendarEvents));
    await loadWeeklyCalendar();
    showToast('האירוע נמחק מכולם בהצלחה');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'שגיאה במחיקת האירוע');
  }
}

function toggleAccessibilityMenu() {
  const modal = document.getElementById('accessibility-modal');
  if (modal.style.display === 'flex') {
    modal.style.display = 'none';
  } else {
    modal.style.display = 'flex';
  }
}

let currentZoom = 1;
function adjustFontSize(direction) {
  currentZoom += direction * 0.08;
  if (currentZoom < 0.85) currentZoom = 0.85;
  if (currentZoom > 1.3) currentZoom = 1.3;
  document.body.style.zoom = currentZoom;
  showToast('גודל תצוגה עודכן');
}

let isHighContrast = localStorage.getItem('class_app_theme') === 'light';

function applyTheme() {
  document.body.classList.toggle('light-theme', isHighContrast);
  const contrastButton = document.querySelector('[onclick="toggleHighContrast()"]');
  if (contrastButton) {
    contrastButton.textContent = isHighContrast ? 'הפעלת מצב כהה 🌙' : 'הפעלת מצב בהיר ☀️';
  }
}

applyTheme();

function toggleHighContrast() {
  isHighContrast = !isHighContrast;
  localStorage.setItem('class_app_theme', isHighContrast ? 'light' : 'dark');
  applyTheme();
  showToast(isHighContrast ? 'הופעל מצב בהיר' : 'הופעל מצב כהה');
}

function verifyAdminPassword() {
  const pass = document.getElementById('admin-password-input').value;
  if (pass === '123') {
    sessionStorage.setItem('admin_password', pass);
    document.getElementById('admin-login-box').style.display = 'none';
    document.getElementById('admin-panel-content').style.display = 'block';
    showToast('התחברת בהצלחה לממשק הניהול!');
    loadUsersList();
    loadMilkRotationAdmin();
  } else {
    showToast('סיסמה שגויה!', true);
  }
}

const adminEmailForm = document.getElementById('admin-email-form');
if (adminEmailForm) {
  adminEmailForm.addEventListener('submit', async e => {
    e.preventDefault();
    const submitButton = e.currentTarget.querySelector('button[type="submit"]');
    const restoreButton = setButtonLoading(submitButton, 'שולחת מייל...');

    try {
      const response = await authFetch(`${API_URL}/auth/admin/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: sessionStorage.getItem('admin_password'),
          toEmail: document.getElementById('admin-email-to').value,
          subject: document.getElementById('admin-email-subject').value,
          content: document.getElementById('admin-email-content').value
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      showToast(data.message || 'המייל המעוצב נשלח בהצלחה!');
      e.currentTarget.reset();
    } catch (err) {
      showToast(err.message || 'שגיאה בשליחת המייל', true);
    } finally {
      restoreButton();
    }
  });
}

async function loadUsersList() {
  const container = document.getElementById('users-management-list');
  try {
    const res = await authFetch(`${API_URL}/auth/users`);
    const users = await res.json();
    container.innerHTML = users.length ? '' : '<div style="color:var(--text-muted)">אין משתמשות רשומות.</div>';
    
    users.forEach(u => {
      container.innerHTML += `
        <div style="background: rgba(0,0,0,0.4); padding: 10px 15px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border-right: 4px solid #f43f5e;">
          <div>
            <span style="font-weight: bold; color: white;">${u.full_name}</span> 
            <span style="font-size: 0.85rem; color: var(--text-muted); margin-right: 10px;">(${u.email})</span>
          </div>
          <button onclick="deleteUser(${u.id})" class="neon-btn outline" style="width: auto; padding: 5px 12px; font-size: 0.8rem; border-color: #f43f5e; color: #f43f5e;">מחיקת משתמשת</button>
        </div>`;
    });
  } catch (err) {
    container.innerHTML = '<div style="color:#f43f5e;">שגיאה בטעינת רשימת המשתמשות</div>';
  }
}

async function deleteUser(userId) {
  if (!await showCustomConfirm('מחיקת משתמשת', 'האם את בטוחה שאת רוצה למחוק משתמשת זו לצמיתות?')) return;

  try {
    const res = await authFetch(`${API_URL}/auth/users/${userId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast('המשתמשת הוסרה בהצלחה!');
      loadUsersList();
    } else {
      showToast('שגיאה במחיקת המשתמשת', true);
    }
  } catch (err) {
    showToast('תקלת תקשורת מול השרת', true);
  }
}

function showCustomConfirm(title, description, confirmLabel = 'כן, מחקי', cancelLabel = 'ביטול') {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const descEl = document.getElementById('modal-desc');
    const inputContainer = document.getElementById('modal-input-container');
    const submitBtn = document.getElementById('modal-submit-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    titleEl.textContent = title;
    descEl.textContent = description;
    descEl.style.display = 'block';
    inputContainer.style.display = 'none';
    submitBtn.style.display = 'block';
    submitBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    modal.style.display = 'flex';

    const newSubmitBtn = submitBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    const close = result => {
      modal.style.display = 'none';
      resolve(result);
    };

    newSubmitBtn.addEventListener('click', () => close(true));
    newCancelBtn.addEventListener('click', () => close(false));
  });
}

function showCustomPrompt(title, description, placeholder, callback) {
  const modal = document.getElementById('custom-modal');
  const titleEl = document.getElementById('modal-title');
  const descEl = document.getElementById('modal-desc');
  const inputContainer = document.getElementById('modal-input-container');
  const inputEl = document.getElementById('modal-input-field');
  const submitBtn = document.getElementById('modal-submit-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');

  titleEl.textContent = title;
  descEl.textContent = description;
  descEl.style.display = 'block';
  inputContainer.style.display = 'block';
  submitBtn.style.display = 'block';
  submitBtn.textContent = 'אישור';
  cancelBtn.textContent = 'ביטול';

  inputEl.value = '';
  inputEl.placeholder = placeholder;
  modal.style.display = 'flex';
  inputEl.focus();

  const newSubmitBtn = submitBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  newSubmitBtn.addEventListener('click', () => {
    const val = inputEl.value.trim();
    modal.style.display = 'none';
    callback(val);
  });

  newCancelBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    callback(null);
  });

  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter') {
      newSubmitBtn.click();
    }
  };
}

document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'forgot-password-link') {
    e.preventDefault();
    
    showCustomPrompt(
      'שחזור סיסמה למערכת',
      'אנא הקישי את כתובת המייל איתה נרשמת, והסיסמה תישלח אלייך ישירות:',
      'name@example.com',
      async (email) => {
        if (!email) return;

        showToast('שולחת מייל שחזור, נא להמתין...');
        try {
          const res = await authFetch(`${API_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const data = await res.json();
          if (res.ok) {
            showToast('הסיסמה נשלחה בהצלחה למייל שלך!');
          } else {
            showToast(data.error || 'שגיאה בשחזור הסיסמה', true);
          }
        } catch (err) {
          showToast('תקלת תקשורת מול השרת', true);
        }
      }
    );
  }
});