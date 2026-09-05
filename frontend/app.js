// קובץ frontend/app.js המעודכן (עם כתובת API יחסית לפריסה ב-Render):
const API_URL = '/api';
let currentUserId = null;

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
      initDashboard(userObj.full_name, userObj.email);
    } else {
      localStorage.removeItem('class_app_user');
      localStorage.removeItem('class_app_time');
    }
  }
});

function saveSession(user) {
  currentUserId = user.id;
  localStorage.setItem('class_app_user', JSON.stringify(user));
  localStorage.setItem('class_app_time', Date.now().toString());
  initDashboard(user.full_name, user.email);
}

function logoutSession() {
  localStorage.removeItem('class_app_user');
  localStorage.removeItem('class_app_time');
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

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const full_name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const msg = document.getElementById('register-message');

  try {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, password })
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = 'ההרשמה הצליחה!';
      msg.style.color = 'var(--neon-cyan)';
      setTimeout(() => saveSession(data.user), 1000);
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
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      msg.textContent = 'התחברת בהצלחה!';
      msg.style.color = 'var(--neon-cyan)';
      setTimeout(() => saveSession(data.user), 1000);
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
}

setInterval(async () => {
  if (!currentUserId) return;
  try {
    const res = await fetch(`${API_URL}/auth/heartbeat`, {
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

  try {
    const res = await fetch(`${API_URL}/notices`, {
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
  }
});

async function loadNotices() {
  const list = document.getElementById('notices-list');
  try {
    const res = await fetch(`${API_URL}/notices`);
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
  if (!confirm('האם את בטוחה שברצונך למחוק הודעה זו?')) return;
  try {
    const res = await fetch(`${API_URL}/notices/${noticeId}`, { method: 'DELETE' });
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
  try {
    const res = await fetch(`${API_URL}/assignments?userId=${currentUserId}`);
    const assignments = await res.json();
    list.innerHTML = assignments.length ? '' : '<div style="color:var(--text-muted)">אין מטלות כרגע.</div>';
    
    assignments.forEach(a => {
      const isChecked = a.is_completed ? 'checked' : '';
      const dateObj = new Date(a.due_date);
      const gregorianDate = dateObj.toLocaleDateString('he-IL');
      
      let hebrewDate = '';
      try {
        const formatter = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long' });
        hebrewDate = formatter.format(dateObj);
      } catch (e) {
        hebrewDate = '';
      }
      
      list.innerHTML += `
        <div class="assignment-card" id="assignment-${a.id}" style="position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div class="assignment-title" style="flex-grow: 1;">${a.subject}: ${a.title}</div>
            <button onclick="deleteAssignment(${a.id})" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.8rem;" title="מחק מטלה">מחיקה ✕</button>
          </div>
          <div class="assignment-date" style="margin-top: 4px;">הגשה: ${gregorianDate} ${hebrewDate ? '(' + hebrewDate + ')' : ''}</div>
          <label style="display:flex; align-items:center; gap:8px; margin-top:8px; font-size:0.9rem; cursor:pointer;">
            <input type="checkbox" class="complete-checkbox custom-checkbox" ${isChecked} onchange="toggleAssignment(${a.id}, this.checked)"> בוצע ✓
          </label>
        </div>`;
    });
  } catch (err) { list.innerHTML = 'שגיאה בטעינת מטלות'; }
}

async function deleteAssignment(assignmentId) {
  if (!confirm('האם את בטוחה שברצונך למחוק מטלה זו?')) return;

  try {
    const res = await fetch(`${API_URL}/assignments/${assignmentId}`, { method: 'DELETE' });
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

  const res = await fetch(`${API_URL}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, title, due_date, difficulty_level: 3 })
  });
  if (res.ok) {
    document.getElementById('add-assignment-form').reset();
    loadAssignments();
    loadAssignmentStats();
    loadWeeklyCalendar();
    loadShvabimSchedule();
    showToast('המטלה נוספה בהצלחה!');
  }
});

async function toggleAssignment(id, isCompleted) {
  await fetch(`${API_URL}/assignments/${id}/note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: currentUserId, is_completed: isCompleted, note_text: '' })
  });
  loadAssignmentStats();
}

async function loadAssignmentStats() {
  const statsList = document.getElementById('stats-list');
  try {
    const res = await fetch(`${API_URL}/assignments/stats/completion`);
    const stats = await res.json();
    statsList.innerHTML = '';
    stats.forEach(s => {
      const comp = parseInt(s.completed_count) || 0;
      const total = parseInt(s.total_users) || 1;
      const pct = Math.round((comp / total) * 100);
      statsList.innerHTML += `
        <div class="assignment-card">
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
    const res = await fetch(`${API_URL}/assignments?userId=${currentUserId}`);
    if (!res.ok) return;
    const assignments = await res.json();

    const todayStr = new Date().toISOString().split('T')[0];

    const activeAssignments = assignments.filter(a => {
      if (!a.subject || !a.due_date) return false;
      if (a.subject.trim().toLowerCase() !== subjectName.trim().toLowerCase()) return false;
      const aDateStr = new Date(a.due_date).toISOString().split('T')[0];
      return aDateStr >= todayStr;
    });

    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const descEl = document.getElementById('modal-desc');
    const inputContainer = document.getElementById('modal-input-container');
    const submitBtn = document.getElementById('modal-submit-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    titleEl.textContent = `שיעורי בית פעילים: ${subjectName}`;
    inputContainer.style.display = 'none';
    submitBtn.style.display = 'none';
    cancelBtn.textContent = 'סגור';

    if (activeAssignments.length === 0) {
      descEl.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 20px;">אין מטלות עתידיות פעילות למקצוע ${subjectName} כרגע. כל הכבוד! 🎉</p>`;
    } else {
      let html = `<div style="display: flex; flex-direction: column; gap: 10px; text-align: right;">`;
      activeAssignments.forEach(a => {
        const gregorianDate = new Date(a.due_date).toLocaleDateString('he-IL');
        html += `
          <div style="background: rgba(0,0,0,0.4); border-right: 4px solid var(--neon-cyan); padding: 10px; border-radius: 6px;">
            <div style="font-weight: bold; color: white; font-size: 0.95rem;">${a.title}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">תאריך הגשה: ${gregorianDate}</div>
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
    const res = await fetch(`${API_URL}/milk`);
    const duties = await res.json();
    
    const activeDuties = duties.filter(d => !d.is_completed);
    const active = activeDuties[0]; 
    const upcoming = activeDuties.slice(1, 4); 
    
    if (active) {
      document.getElementById('current-milk-person').textContent = active.full_name;
      const fulfillContainer = document.getElementById('fulfill-milk-container');
      const notYourTurnMsg = document.getElementById('not-your-turn-msg');
      
      if (active.user_id === currentUserId) {
        fulfillContainer.style.display = 'block';
        notYourTurnMsg.style.display = 'none';
      } else {
        fulfillContainer.style.display = 'none';
        notYourTurnMsg.style.display = 'block';
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

    } else {
      document.getElementById('current-milk-person').textContent = 'אין תורניות רשומות בתור כרגע';
      document.getElementById('fulfill-milk-container').style.display = 'none';
      document.getElementById('not-your-turn-msg').style.display = 'none';
      const upcomingContainer = document.getElementById('upcoming-milk-queue');
      if (upcomingContainer) upcomingContainer.innerHTML = '';
    }
  } catch (err) {
    document.getElementById('current-milk-person').textContent = 'שגיאה בטעינת נתוני תורנות';
  }
}

async function joinMilkQueue() {
  if (!currentUserId) {
    showToast('יש להתחבר קודם', true);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/milk/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUserId })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('נרשמת בהצלחה לתורנות החלב!');
      loadMilkRotation();
    } else {
      showToast(data.error || 'שגיאה בהרשמה לתור', true);
    }
  } catch (err) {
    showToast('תקלת תקשורת מול השרת', true);
  }
}

async function fulfillMilkDuty() {
  try {
    const res = await fetch(`${API_URL}/milk`);
    const duties = await res.json();
    const active = duties.find(d => !d.is_completed);
    
    if (active) {
      if (active.user_id !== currentUserId) {
        showToast('רק התורנית הנוכחית יכולה לסמן שקנתה את החלב!', true);
        return;
      }

      await fetch(`${API_URL}/milk/${active.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_completed: true })
      });
      showToast('התורנות סומנה כבוצעה! התור עבר אוטומטית לבת הבאה.');
      loadMilkRotation();
    }
  } catch (err) {
    showToast('שגיאה בעדכון התורנות', true);
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
  
  let assignments = [];
  try {
    if (currentUserId) {
      const res = await fetch(`${API_URL}/assignments?userId=${currentUserId}`);
      if (res.ok) assignments = await res.json();
    }
  } catch (err) {}

  const todayStr = new Date().toISOString().split('T')[0];

  weekDays.forEach(day => {
    const dateString = day.toISOString().split('T')[0];
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
      return new Date(a.due_date).toISOString().split('T')[0] === dateString;
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
            <div style="background: rgba(168,85,247,0.15); border-right: 3px solid var(--neon-purple); padding: 5px 8px; border-radius: 4px; font-size: 0.8rem; display:flex; justify-content:space-between; align-items:center;">
              <span>📌 ${e.title}</span>
              <button onclick="deleteEvent(${e.id})" style="background:none; border:none; color:#f43f5e; cursor:pointer; font-size:0.75rem; padding:0;">✕</button>
            </div>`).join('')}
          ${!dayAssignments.length && !dayEvents.length ? '<span style="color: var(--text-muted); font-size: 0.75rem; text-align: center; margin-top: auto; margin-bottom: auto;">אין אירועים או מטלות</span>' : ''}
        </div>
      </div>`;
  });
}

const calendarForm = document.getElementById('calendar-event-form');
if (calendarForm) {
  calendarForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('event-title').value;
    const date = document.getElementById('event-date').value;

    let localCalendarEvents = JSON.parse(localStorage.getItem('class_events')) || [];
    localCalendarEvents.push({ id: Date.now(), title, date });
    localStorage.setItem('class_events', JSON.stringify(localCalendarEvents));
    calendarForm.reset();
    loadWeeklyCalendar();
    showToast('האירוע נוסף ללוח השנה!');
  });
}

function deleteEvent(id) {
  let localCalendarEvents = JSON.parse(localStorage.getItem('class_events')) || [];
  localCalendarEvents = localCalendarEvents.filter(ev => ev.id !== id);
  localStorage.setItem('class_events', JSON.stringify(localCalendarEvents));
  loadWeeklyCalendar();
  showToast('האירוע נמחק בהצלחה');
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

let isHighContrast = false;
function toggleHighContrast() {
  isHighContrast = !isHighContrast;
  if (isHighContrast) {
    document.body.style.backgroundColor = '#000000';
    document.body.style.color = '#ffffff';
    showToast('הופעל מצב ניגודיות גבוהה');
  } else {
    document.body.style.backgroundColor = '';
    document.body.style.color = '';
    showToast('הוחזר מצב תצוגה רגיל');
  }
}

function verifyAdminPassword() {
  const pass = document.getElementById('admin-password-input').value;
  if (pass === '123') {
    document.getElementById('admin-login-box').style.display = 'none';
    document.getElementById('admin-panel-content').style.display = 'block';
    showToast('התחברת בהצלחה לממשק הניהול!');
    loadUsersList();
  } else {
    showToast('סיסמה שגויה!', true);
  }
}

async function loadUsersList() {
  const container = document.getElementById('users-management-list');
  try {
    const res = await fetch(`${API_URL}/auth/users`);
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
  if (!confirm('האם את בטוחה שאת רוצה למחוק משתמשת זו לצמיתות?')) return;

  try {
    const res = await fetch(`${API_URL}/auth/users/${userId}`, {
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

        try {
          const res = await fetch(`${API_URL}/auth/forgot-password`, {
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