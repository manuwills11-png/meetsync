/* ============================================================
   app.js — MeetSync Application Logic
============================================================ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/* ============================================================
   SUPABASE CONFIG
============================================================ */
const SUPABASE_URL = 'https://lflgbzovkqqsyaobzfrf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxmbGdiem92a3Fxc3lhb2J6ZnJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTA4OTIsImV4cCI6MjA4NzA2Njg5Mn0._jCL3_vw2FzeJzIzuIPB_gq6yrFamHd7hjAY3g_bl5U';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ============================================================
   STATE
============================================================ */
let _meetings    = [];
let _recurring   = [];
let _currentUser = null;
let _isSignup    = false;

const getMeetings  = () => _meetings;
const getRecurring = () => _recurring;

/* ============================================================
   SETTINGS
============================================================ */
const getSettings = () => JSON.parse(localStorage.getItem('settings')) || {
  profile:       { username: '', email: '' },
  notifications: { browser: false, reminderMinutes: 15 },
  defaults:      { platform: 'meet', duration: 30 },
  availability:  { start: '09:00', end: '17:00', buffer: 0, maxPerDay: 10 },
  appearance:    { theme: '' }
};
const saveSettings = s => localStorage.setItem('settings', JSON.stringify(s));

/* ============================================================
   UTILITIES
============================================================ */
function toast(msg, type = 'info') {
  const tc   = document.getElementById('toastContainer');
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  const el   = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ti">${icon}</span>${msg}`;
  tc.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function buildLink(platform, code) {
  if (platform === 'meet')  return `https://meet.google.com/${code}`;
  if (platform === 'zoom')  return `https://zoom.us/j/${code}`;
  if (platform === 'jitsi') return `https://meet.jit.si/${code}`;
  return '#';
}

function platIcon(platform) {
  if (platform === 'meet')  return '🎥';
  if (platform === 'zoom')  return '💻';
  if (platform === 'jitsi') return '🌐';
  return '📹';
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function setAuthLoading(loading) {
  const btn    = document.getElementById('authBtn');
  btn.disabled = loading;
  btn.innerText = loading
    ? (_isSignup ? 'Creating…' : 'Signing in…')
    : (_isSignup ? 'Create Account' : 'Sign In');
}

/* ============================================================
   AUTH
============================================================ */
function toggleMode() {
  _isSignup = !_isSignup;
  document.getElementById('confirmWrap').style.display = _isSignup ? 'block' : 'none';
  document.getElementById('resetWrap').style.display   = _isSignup ? 'none'  : 'block';
  document.getElementById('authTitle').innerText       = _isSignup ? 'Create account' : 'Welcome back';
  document.getElementById('authSubtitle').innerText    = _isSignup ? 'Fill in the details to get started.' : 'Sign in to your workspace to continue.';
  document.getElementById('authBtn').innerText         = _isSignup ? 'Create Account' : 'Sign In';
  document.getElementById('toggleText').innerText      = _isSignup ? 'Already have an account?' : "Don't have an account?";
  document.getElementById('toggleLink').innerText      = _isSignup ? ' Sign in' : ' Sign up';
  document.getElementById('authMessage').innerText     = '';
  document.getElementById('authMessage').className     = 'auth-message';
}

async function handleAuth() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value.trim();
  const confirm  = document.getElementById('confirmPassword').value.trim();
  const msg      = document.getElementById('authMessage');

  if (!email || !password) {
    msg.innerText = 'Please fill in all fields.';
    msg.className = 'auth-message msg-error';
    return;
  }

  setAuthLoading(true);

  if (_isSignup) {
    if (password !== confirm) {
      msg.innerText = 'Passwords do not match.';
      msg.className = 'auth-message msg-error';
      setAuthLoading(false);
      return;
    }
    if (password.length < 6) {
      msg.innerText = 'Password must be at least 6 characters.';
      msg.className = 'auth-message msg-error';
      setAuthLoading(false);
      return;
    }
    const { error } = await sb.auth.signUp({ email, password });
    setAuthLoading(false);
    if (error) { msg.innerText = error.message; msg.className = 'auth-message msg-error'; return; }
    msg.innerText = '✅ Account created! Sign in below.';
    msg.className = 'auth-message msg-success';
    toggleMode();
    return;
  }

  // Mark OTP flow as pending BEFORE signing in, so onAuthStateChange ignores the SIGNED_IN event
  window._pendingEmail = email;

  // Sign in — verify password first
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  setAuthLoading(false);

  if (error) {
    window._pendingEmail = null;
    msg.innerText = 'Invalid email or password.';
    msg.className = 'auth-message msg-error';
    return;
  }

  // Sign out, then send OTP for 2FA
  await sb.auth.signOut();
  const { error: otpError } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  });

  if (otpError) {
    window._pendingEmail = null;
    msg.innerText = otpError.message;
    msg.className = 'auth-message msg-error';
    return;
  }

  showOTPScreen();
}

async function handlePasswordReset() {
  const email = document.getElementById('authEmail').value.trim();
  const msg   = document.getElementById('authMessage');
  if (!email) {
    msg.innerText = 'Enter your email address above first.';
    msg.className = 'auth-message msg-error';
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) {
    msg.innerText = error.message;
    msg.className = 'auth-message msg-error';
  } else {
    msg.innerText = '📧 Password reset email sent! Check your inbox.';
    msg.className = 'auth-message msg-success';
  }
}

/* ============================================================
   OTP
============================================================ */
function showOTPScreen() {
  document.getElementById('loginScreen').style.display = 'none';
  const screen = document.getElementById('otpScreen');
  screen.style.display = 'flex';
  document.getElementById('otpSubtitle').innerText = `We sent a 6-digit code to ${window._pendingEmail}`;
}

async function verifyOTP() {
  const code = document.getElementById('otpInput').value.trim();
  const msg  = document.getElementById('otpMessage');
  const btn  = document.getElementById('otpBtn');

  if (code.length !== 6) {
    msg.innerText   = 'Please enter the 6-digit code.';
    msg.style.color = 'var(--red)';
    return;
  }

  btn.disabled  = true;
  btn.innerText = 'Verifying…';

  const { data, error } = await sb.auth.verifyOtp({
    email: window._pendingEmail,
    token: code,
    type:  'email'
  });

  if (error) {
    msg.innerText   = 'Invalid or expired code. Try again.';
    msg.style.color = 'var(--red)';
    btn.disabled    = false;
    btn.innerText   = 'Verify Code';
    return;
  }

  document.getElementById('otpScreen').style.display = 'none';
  window._pendingEmail = null;
  await loginSuccess(data.user);
}

async function resendOTP() {
  const msg = document.getElementById('otpMessage');
  const { error } = await sb.auth.signInWithOtp({
    email: window._pendingEmail,
    options: { shouldCreateUser: false }
  });
  if (error) {
    msg.innerText   = error.message;
    msg.style.color = 'var(--red)';
  } else {
    msg.innerText   = '✅ New code sent! Check your email.';
    msg.style.color = 'var(--green)';
  }
}

/* ============================================================
   SESSION
============================================================ */
async function loginSuccess(user) {
  _currentUser = user;
  const displayName = user.email.split('@')[0];
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('otpScreen').style.display   = 'none';
  document.querySelector('.shell').style.display       = 'flex';
  document.getElementById('sidebarName').innerText     = displayName;
  document.getElementById('sidebarAvatar').innerText   = displayName.charAt(0).toUpperCase();
  const s = getSettings();
  if (!s.profile.email) { s.profile.email = user.email; saveSettings(s); }
  await fetchAllData();
  initApp();
}

async function logout() {
  await sb.auth.signOut();
  _currentUser = null;
  _meetings    = [];
  _recurring   = [];
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('authEmail').value           = '';
  document.getElementById('authPassword').value        = '';
  document.getElementById('authMessage').innerText     = '';
}

/* ============================================================
   2FA
============================================================ */
async function setup2FA() {
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp' });
  if (error) { toast('Error setting up 2FA: ' + error.message, 'error'); return; }
  document.getElementById('qrCode').src                = data.totp.qr_code;
  document.getElementById('qrContainer').style.display = 'block';
  window._mfaFactorId = data.id;
  toast('Scan the QR code with your authenticator app', 'info');
}

async function verify2FA() {
  const code = document.getElementById('totpCode').value.trim();
  if (code.length !== 6) { toast('Enter a 6-digit code', 'error'); return; }
  const { data: challengeData, error: challengeError } = await sb.auth.mfa.challenge({ factorId: window._mfaFactorId });
  if (challengeError) { toast(challengeError.message, 'error'); return; }
  const { error } = await sb.auth.mfa.verify({ factorId: window._mfaFactorId, challengeId: challengeData.id, code });
  if (error) { toast('Invalid code. Try again.', 'error'); return; }
  toast('2FA enabled successfully! ✅', 'success');
  document.getElementById('qrContainer').style.display = 'none';
}

async function disable2FA() {
  if (!confirm('Are you sure you want to disable two-factor authentication? This will make your account less secure.')) return;
  const { data, error: listError } = await sb.auth.mfa.listFactors();
  if (listError) { toast('Error fetching 2FA factors: ' + listError.message, 'error'); return; }
  const factors = data?.totp || [];
  if (factors.length === 0) { toast('No 2FA factors found on your account.', 'info'); return; }
  let hadError = false;
  for (const factor of factors) {
    const { error } = await sb.auth.mfa.unenroll({ factorId: factor.id });
    if (error) { toast('Error removing factor: ' + error.message, 'error'); hadError = true; }
  }
  if (!hadError) toast('2FA disabled successfully.', 'success');
}

/* ============================================================
   DATA FETCHING
============================================================ */
async function fetchAllData() {
  if (!_currentUser) return;
  const [{ data: m, error: e1 }, { data: r, error: e2 }] = await Promise.all([
    sb.from('meetings').select('*').eq('user_id', _currentUser.id).order('date').order('time'),
    sb.from('recurring').select('*').eq('user_id', _currentUser.id).order('created_at')
  ]);
  if (e1) console.error('Meetings fetch error:', e1.message);
  else    _meetings  = m || [];
  if (e2) console.error('Recurring fetch error:', e2.message);
  else    _recurring = r || [];
}

/* ============================================================
   NAVIGATION
============================================================ */
function showPage(id, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const nb = btn || document.getElementById('nav-' + id);
  if (nb) nb.classList.add('active');
  if (id === 'analytics') updateAnalytics();
  if (id === 'settings')  loadSettings('profile', document.querySelector('.settings-tab'));
  if (id === 'meetings')  loadMeetings();
}

/* ============================================================
   MEETINGS CRUD
============================================================ */
async function addMeeting() {
  const subject  = document.getElementById('subject').value.trim();
  const date     = document.getElementById('date').value;
  const time     = document.getElementById('time').value;
  const platform = document.getElementById('platform').value;
  const code     = document.getElementById('code').value.trim();
  const notes    = document.getElementById('notes').value.trim();
  if (!subject || !date || !time || !platform || !code) {
    toast('Please fill in all required fields.', 'error'); return;
  }
  const { data, error } = await sb.from('meetings').insert({
    user_id: _currentUser.id, subject, date, time, platform, code,
    link: buildLink(platform, code), notes
  }).select().single();
  if (error) { toast('Error saving meeting: ' + error.message, 'error'); return; }
  _meetings.push(data);
  closeModal('meetingModal');
  ['subject','code','notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('date').value = '';
  document.getElementById('time').value = '';
  refreshAll();
  toast('Meeting scheduled!', 'success');
}

function loadMeetings() {
  const query    = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const meetings  = getMeetings();
  const recurring = getRecurring();
  const list      = document.getElementById('meetingList');
  list.innerHTML  = '';
  let count = 0;

  meetings.forEach(m => {
    if (query && !m.subject.toLowerCase().includes(query) && !m.platform.includes(query)) return;
    count++;
    list.innerHTML += `
      <div class="meeting-card">
        <div class="meeting-avatar plat-${m.platform}">${platIcon(m.platform)}</div>
        <div class="meeting-info">
          <div class="meeting-title">${m.subject}</div>
          <div class="meeting-meta">
            <span>📅 ${m.date}</span><span>🕐 ${m.time}</span>
            <span class="meeting-badge badge-${m.platform}">${m.platform==='meet'?'Google Meet':m.platform==='zoom'?'Zoom':'Jitsi'}</span>
          </div>
        </div>
        <div class="meeting-actions">
          <button class="icon-btn join"   onclick="window.open('${m.link}','_blank')" title="Join">▶</button>
          <button class="icon-btn"        onclick="openEditModal('${m.id}')"           title="Edit">✏️</button>
          <button class="icon-btn danger" onclick="deleteMeeting('${m.id}')"           title="Delete">🗑️</button>
        </div>
      </div>`;
  });

  recurring.forEach(r => {
    if (query && !r.subject.toLowerCase().includes(query)) return;
    count++;
    const link = buildLink(r.platform, r.code);
    list.innerHTML += `
      <div class="meeting-card">
        <div class="meeting-avatar plat-${r.platform}">${platIcon(r.platform)}</div>
        <div class="meeting-info">
          <div class="meeting-title">${r.subject}</div>
          <div class="meeting-meta">
            <span>🔄 ${r.days.join(', ')}</span><span>🕐 ${r.time}</span>
            <span class="meeting-badge badge-rec">Recurring</span>
            <span class="meeting-badge badge-${r.platform}">${r.platform}</span>
          </div>
        </div>
        <div class="meeting-actions">
          <button class="icon-btn join"   onclick="window.open('${link}','_blank')"  title="Join">▶</button>
          <button class="icon-btn"        onclick="openRecurringEdit('${r.id}')"      title="Edit">✏️</button>
          <button class="icon-btn danger" onclick="deleteRecurring('${r.id}')"        title="Delete">🗑️</button>
        </div>
      </div>`;
  });

  if (count === 0) {
    list.innerHTML = `<div class="empty-state"><div class="ei">📭</div>
      <h4>${query ? 'No results found' : 'No meetings yet'}</h4>
      <p>${query ? 'Try a different search term.' : 'Click "+ New Meeting" to get started.'}</p></div>`;
  }
}

function openEditModal(id) {
  const m = _meetings.find(x => x.id === id);
  if (!m) return;
  document.getElementById('editSubject').value  = m.subject;
  document.getElementById('editDate').value     = m.date;
  document.getElementById('editTime').value     = m.time;
  document.getElementById('editPlatform').value = m.platform;
  document.getElementById('editCode').value     = m.code;
  document.getElementById('editIndex').value    = id;
  openModal('editModal');
}

async function updateMeeting() {
  const id       = document.getElementById('editIndex').value;
  const platform = document.getElementById('editPlatform').value;
  const code     = document.getElementById('editCode').value.trim();
  const updates  = {
    subject: document.getElementById('editSubject').value.trim(),
    date:    document.getElementById('editDate').value,
    time:    document.getElementById('editTime').value,
    platform, code, link: buildLink(platform, code)
  };
  const { data, error } = await sb.from('meetings').update(updates).eq('id', id).select().single();
  if (error) { toast('Error updating: ' + error.message, 'error'); return; }
  _meetings = _meetings.map(m => m.id === id ? data : m);
  closeModal('editModal');
  refreshAll();
  toast('Meeting updated!', 'success');
}

async function deleteMeeting(id) {
  if (!confirm('Delete this meeting?')) return;
  const { error } = await sb.from('meetings').delete().eq('id', id);
  if (error) { toast('Error deleting: ' + error.message, 'error'); return; }
  _meetings = _meetings.filter(m => m.id !== id);
  refreshAll();
  toast('Meeting removed.', 'info');
}

/* ============================================================
   RECURRING CRUD
============================================================ */
async function createRecurring() {
  const subject  = document.getElementById('recSubject').value.trim();
  const platform = document.getElementById('recPlatform').value;
  const code     = document.getElementById('recCode').value.trim();
  const time     = document.getElementById('recTime').value;
  const days     = Array.from(document.querySelectorAll('#dashboard .day-grid input:checked')).map(c => c.value);
  if (!subject || !code || !time || days.length === 0) {
    toast('Please fill in all fields and select at least one day.', 'error'); return;
  }
  const { data, error } = await sb.from('recurring').insert({
    user_id: _currentUser.id, subject, platform, code, time, days
  }).select().single();
  if (error) { toast('Error saving recurring: ' + error.message, 'error'); return; }
  _recurring.push(data);
  document.getElementById('recSubject').value = '';
  document.getElementById('recCode').value    = '';
  document.getElementById('recTime').value    = '';
  document.querySelectorAll('#dashboard .day-grid input:checked').forEach(cb => cb.checked = false);
  refreshAll();
  toast('Recurring meeting created!', 'success');
}

function openRecurringEdit(id) {
  const r = _recurring.find(x => x.id === id);
  if (!r) return;
  document.getElementById('editRecSubject').value  = r.subject;
  document.getElementById('editRecTime').value     = r.time;
  document.getElementById('editRecCode').value     = r.code;
  document.getElementById('editRecPlatform').value = r.platform;
  document.getElementById('editRecIndex').value    = id;
  document.querySelectorAll('#editRecDays input').forEach(cb => { cb.checked = r.days.includes(cb.value); });
  openModal('editRecurringModal');
}

async function updateRecurring() {
  const id   = document.getElementById('editRecIndex').value;
  const days = Array.from(document.querySelectorAll('#editRecDays input:checked')).map(c => c.value);
  const updates = {
    subject:  document.getElementById('editRecSubject').value.trim(),
    time:     document.getElementById('editRecTime').value,
    code:     document.getElementById('editRecCode').value.trim(),
    platform: document.getElementById('editRecPlatform').value,
    days
  };
  const { data, error } = await sb.from('recurring').update(updates).eq('id', id).select().single();
  if (error) { toast('Error updating: ' + error.message, 'error'); return; }
  _recurring = _recurring.map(r => r.id === id ? data : r);
  closeModal('editRecurringModal');
  refreshAll();
  toast('Recurring meeting updated!', 'success');
}

async function deleteRecurring(id) {
  if (!confirm('Delete this recurring meeting?')) return;
  const { error } = await sb.from('recurring').delete().eq('id', id);
  if (error) { toast('Error deleting: ' + error.message, 'error'); return; }
  _recurring = _recurring.filter(r => r.id !== id);
  refreshAll();
  toast('Recurring meeting removed.', 'info');
}

/* ============================================================
   DASHBOARD
============================================================ */
function updateDashboardStats() {
  const meetings  = getMeetings();
  const recurring = getRecurring();
  const today     = localToday();
  const todayDay  = new Date().toLocaleString('default', { weekday: 'short' });
  const todayOnce = meetings.filter(m => m.date === today);
  const todayRec  = recurring.filter(r => r.days.includes(todayDay));
  const todayCount = todayOnce.length + todayRec.length;

  document.getElementById('statTotal').innerText     = meetings.length + recurring.length;
  document.getElementById('statRecurring').innerText = recurring.length;
  document.getElementById('statToday').innerText     = todayCount;
  document.getElementById('todayBadge').innerText    = todayCount;

  const allToday = [...todayOnce];
  todayRec.forEach(r => allToday.push({ subject: r.subject, time: r.time, platform: r.platform }));
  const ul = document.getElementById('upcomingList');
  if (allToday.length === 0) {
    ul.innerHTML = '<div class="upcoming-empty">No meetings today. Enjoy your day! 🎉</div>';
    return;
  }
  allToday.sort((a, b) => a.time.localeCompare(b.time));
  ul.innerHTML = allToday.map(m => `
    <div class="upcoming-item">
      <div class="upcoming-dot ${m.platform || 'other'}"></div>
      <div class="upcoming-info">
        <div class="upcoming-title">${m.subject}</div>
        <div class="upcoming-meta">${m.platform==='meet'?'Google Meet':m.platform==='zoom'?'Zoom':m.platform==='jitsi'?'Jitsi':''}</div>
      </div>
      <div class="upcoming-time">${m.time}</div>
    </div>`).join('');
}

/* ============================================================
   CLOCK
============================================================ */
function updateClock() {
  const now    = new Date();
  const h      = now.getHours();
  const greet  = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  const emojis = { morning:'☀️', afternoon:'🌤️', evening:'🌙', night:'⭐' };
  const tkey   = h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  const name   = _currentUser ? _currentUser.email.split('@')[0] : '';
  document.getElementById('liveClock').innerText    = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  document.getElementById('liveDate').innerText     = now.toLocaleDateString();
  document.getElementById('clockBig').innerText     = now.toLocaleTimeString();
  document.getElementById('clockDate').innerText    = now.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  document.getElementById('clockDay').innerText     = `${emojis[tkey]} ${now.toLocaleString('default', { weekday:'long' })}`;
  document.getElementById('heroGreeting').innerText = greet;
  document.getElementById('heroTitle').innerText    = name ? `Hey ${name}, what's on for today? 🚀` : "Ready for today's meetings? 🚀";
}

/* ============================================================
   CALENDAR
============================================================ */
let calMonth = new Date().getMonth();
let calYear  = new Date().getFullYear();

function renderCalendar() {
  const cal = document.getElementById('calendar');
  cal.innerHTML = '';
  document.getElementById('monthYear').innerText =
    new Date(calYear, calMonth).toLocaleString('default', { month:'long' }) + ' ' + calYear;
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => {
    cal.innerHTML += `<div class="cal-day-label">${d}</div>`;
  });
  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const meetings    = getMeetings();
  const recurring   = getRecurring();
  const today       = localToday();
  for (let i = 0; i < firstDay; i++) cal.innerHTML += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const wd = new Date(ds+'T12:00:00').toLocaleString('default', { weekday:'short' });
    const hasMeeting = meetings.some(m => m.date===ds) || recurring.some(r => r.days.includes(wd));
    const isToday    = ds === today;
    cal.innerHTML += `<div class="cal-day ${hasMeeting?'has-meeting':''} ${isToday?'today':''}" onclick="showMeetingsForDate('${ds}',this)">${d}</div>`;
  }
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  renderCalendar();
  document.getElementById('dayMeetings').innerHTML = '';
}

function showMeetingsForDate(date, el) {
  document.querySelectorAll('.cal-day.selected').forEach(d => d.classList.remove('selected'));
  if (el) el.classList.add('selected');
  const meetings  = getMeetings();
  const recurring = getRecurring();
  const wd = new Date(date+'T12:00:00').toLocaleString('default', { weekday:'short' });
  const filtered = meetings.filter(m => m.date===date);
  recurring.forEach(r => {
    if (r.days.includes(wd)) filtered.push({ subject:r.subject, time:r.time, platform:r.platform, link:buildLink(r.platform,r.code) });
  });
  const container = document.getElementById('dayMeetings');
  container.innerHTML = `<h4>${new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</h4>`;
  if (filtered.length === 0) {
    container.innerHTML += '<div class="upcoming-empty" style="padding:12px 0;">No meetings on this day.</div>';
    return;
  }
  filtered.sort((a,b)=>a.time.localeCompare(b.time)).forEach(m => {
    container.innerHTML += `
      <div class="upcoming-item">
        <div class="upcoming-dot ${m.platform||'other'}"></div>
        <div class="upcoming-info">
          <div class="upcoming-title">${m.subject}</div>
          <div class="upcoming-meta">${m.platform||''}</div>
        </div>
        <div class="upcoming-time">${m.time}</div>
        <button class="icon-btn join" onclick="window.open('${m.link}','_blank')" style="margin-left:8px;width:28px;height:28px;font-size:12px;">▶</button>
      </div>`;
  });
}

/* ============================================================
   ANALYTICS
============================================================ */
let platformChart, weekdayChart;

function updateAnalytics() {
  const meetings  = getMeetings();
  const recurring = getRecurring();
  const today     = localToday();
  const todayDay  = new Date().toLocaleString('default', { weekday:'short' });
  const todayCount = meetings.filter(m=>m.date===today).length + recurring.filter(r=>r.days.includes(todayDay)).length;

  document.getElementById('totalMeetingsStat').innerText = meetings.length + recurring.length;
  document.getElementById('recurringStat').innerText     = recurring.length;
  document.getElementById('todayStat').innerText         = todayCount;

  const pc = { meet:0, zoom:0, jitsi:0 };
  [...meetings,...recurring].forEach(m => { if (pc[m.platform]!==undefined) pc[m.platform]++; });
  const wc = { Sun:0, Mon:0, Tue:0, Wed:0, Thu:0, Fri:0, Sat:0 };
  meetings.forEach(m => { const d=new Date(m.date+'T12:00:00').toLocaleString('default',{weekday:'short'}); if(wc[d]!==undefined) wc[d]++; });
  recurring.forEach(r => r.days.forEach(d => { if(wc[d]!==undefined) wc[d]++; }));

  if (platformChart) platformChart.destroy();
  if (weekdayChart)  weekdayChart.destroy();
  Chart.defaults.color       = '#8888a8';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.07)';

  platformChart = new Chart(document.getElementById('platformChart'), {
    type: 'doughnut',
    data: { labels:['Google Meet','Zoom','Jitsi'], datasets:[{ data:[pc.meet,pc.zoom,pc.jitsi], backgroundColor:['#7c6cf8','#22d3a0','#fbbf24'], borderWidth:0, hoverOffset:8 }] },
    options: { responsive:true, maintainAspectRatio:true, cutout:'68%', plugins:{ legend:{ position:'bottom', labels:{ padding:14, font:{ size:11 } } } } }
  });
  weekdayChart = new Chart(document.getElementById('weekdayChart'), {
    type: 'bar',
    data: { labels:Object.keys(wc), datasets:[{ label:'Meetings', data:Object.values(wc), backgroundColor:'rgba(124,108,248,0.75)', borderRadius:6, borderSkipped:false }] },
    options: { responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });
}

/* ============================================================
   SETTINGS
============================================================ */
function loadSettings(section, btn) {
  document.querySelectorAll('.settings-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const c = document.getElementById('settingsContent');
  const s = getSettings();

  if (section === 'profile') {
    const email = _currentUser ? _currentUser.email : s.profile.email;
    c.innerHTML = `<h3>Profile</h3><p class="desc">Manage your account details.</p>
      <div class="form-group mb-4"><label class="form-label">Display Name</label><input class="form-control" id="sUsername" value="${s.profile.username}" placeholder="Your name"></div>
      <div class="form-group mb-4"><label class="form-label">Email Address</label><input class="form-control" id="sEmail" type="email" value="${email}" disabled style="opacity:0.6;cursor:not-allowed;"></div>
      <p style="font-size:12px;color:var(--text-3);margin-bottom:20px;">Email is managed by Supabase Auth.</p>
      <div class="form-group mb-4"><label class="form-label">New Password</label><input class="form-control" id="sPass" type="password" placeholder="Enter new password to change"></div>
      <button class="btn-accent" onclick="saveProfile()">Save Changes</button>`;
  } else if (section === 'security') {
    c.innerHTML = `<h3>Security</h3><p class="desc">Manage account security.</p>
      <div class="setting-row">
        <div class="setting-row-info"><h5>Two-Factor Authentication</h5><p>Use an authenticator app.</p></div>
        <button class="btn-ghost" onclick="setup2FA()">Enable 2FA</button>
      </div>
      <div id="qrContainer" style="margin-top:20px;display:none;">
        <p style="margin-bottom:10px;font-size:13px;color:var(--text-2);">Scan this QR code:</p>
        <img id="qrCode" style="border-radius:10px;" />
        <div style="margin-top:14px;">
          <label class="form-label">Enter 6-digit code to confirm</label>
          <div style="display:flex;gap:10px;margin-top:6px;">
            <input class="form-control" type="text" id="totpCode" placeholder="123456" maxlength="6" style="max-width:160px;">
            <button class="btn-accent" onclick="verify2FA()">Verify</button>
          </div>
        </div>
      </div>
      <div class="setting-row" style="margin-top:10px;">
        <div class="setting-row-info"><h5>Disable 2FA</h5><p>Remove all authenticator app factors from your account.</p></div>
        <button class="btn-ghost" style="border-color:var(--red);color:var(--red);" onclick="disable2FA()">Disable 2FA</button>
      </div>
      <div class="setting-row" style="margin-top:10px;">
        <div class="setting-row-info"><h5>Password Reset</h5><p>Send a reset link to your email.</p></div>
        <button class="btn-ghost" onclick="sendPasswordReset()">Send Email</button>
      </div>`;
  } else if (section === 'notifications') {
    c.innerHTML = `<h3>Notifications</h3><p class="desc">Configure reminder preferences.</p>
      <div class="setting-row">
        <div class="setting-row-info"><h5>Browser Notifications</h5><p>Get in-browser alerts before meetings.</p></div>
        <label class="toggle"><input type="checkbox" id="browserToggle" ${s.notifications.browser?'checked':''}><div class="toggle-track"></div></label>
      </div>
      <div class="range-wrap">
        <div class="range-header"><span>Reminder Time Before Meeting</span><span id="reminderVal">${s.notifications.reminderMinutes} min</span></div>
        <input type="range" id="reminderSlider" min="5" max="60" value="${s.notifications.reminderMinutes}" oninput="document.getElementById('reminderVal').innerText=this.value+' min'">
      </div>
      <button class="btn-accent" onclick="saveNotifications()">Save Notifications</button>`;
  } else if (section === 'defaults') {
    c.innerHTML = `<h3>Meeting Defaults</h3><p class="desc">Set default options for new meetings.</p>
      <div class="form-group mb-4"><label class="form-label">Default Platform</label>
        <select class="form-control" id="defPlatform">
          <option value="meet" ${s.defaults.platform==='meet'?'selected':''}>Google Meet</option>
          <option value="zoom" ${s.defaults.platform==='zoom'?'selected':''}>Zoom</option>
          <option value="jitsi" ${s.defaults.platform==='jitsi'?'selected':''}>Jitsi</option>
        </select></div>
      <div class="form-group mb-4"><label class="form-label">Default Duration</label>
        <select class="form-control" id="defDuration">
          <option value="15" ${s.defaults.duration===15?'selected':''}>15 Minutes</option>
          <option value="30" ${s.defaults.duration===30?'selected':''}>30 Minutes</option>
          <option value="60" ${s.defaults.duration===60?'selected':''}>1 Hour</option>
        </select></div>
      <button class="btn-accent" onclick="saveDefaults()">Save Defaults</button>`;
  } else if (section === 'availability') {
    c.innerHTML = `<h3>Availability</h3><p class="desc">Define your working hours.</p>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Start Time</label><input class="form-control" type="time" id="availStart" value="${s.availability.start}"></div>
        <div class="form-group"><label class="form-label">End Time</label><input class="form-control" type="time" id="availEnd" value="${s.availability.end}"></div>
        <div class="form-group"><label class="form-label">Buffer (min)</label><input class="form-control" type="number" id="availBuffer" value="${s.availability.buffer}" min="0" max="60"></div>
        <div class="form-group"><label class="form-label">Max / Day</label><input class="form-control" type="number" id="availMax" value="${s.availability.maxPerDay}" min="1" max="20"></div>
      </div>
      <button class="btn-accent mt-4" onclick="saveAvailability()">Save Availability</button>`;
  } else if (section === 'appearance') {
    const themes = [
      { id:'',             label:'Default',   bg:'linear-gradient(135deg,#0a0a0f,#7c6cf8)' },
      { id:'theme-dark',   label:'Pure Dark', bg:'linear-gradient(135deg,#090909,#333)' },
      { id:'theme-ocean',  label:'Ocean',     bg:'linear-gradient(135deg,#060d1a,#38bdf8)' },
      { id:'theme-forest', label:'Forest',    bg:'linear-gradient(135deg,#070f0a,#22d3a0)' },
      { id:'theme-rose',   label:'Rose',      bg:'linear-gradient(135deg,#110a0f,#f472b6)' },
    ];
    c.innerHTML = `<h3>Appearance</h3><p class="desc">Customize your workspace look.</p>
      <div class="theme-grid">
        ${themes.map(t=>`<div class="theme-swatch ${s.appearance.theme===t.id?'active':''}" style="background:${t.bg}" onclick="changeTheme('${t.id}',this)"><span>${t.label}</span></div>`).join('')}
      </div>`;
  } else if (section === 'data') {
    c.innerHTML = `<h3>Data & Privacy</h3><p class="desc">Manage your stored data.</p>
      <div class="setting-row"><div class="setting-row-info"><h5>Export All Data</h5><p>Download meetings as JSON.</p></div><button class="btn-ghost" onclick="exportData()">Export</button></div>
      <div class="setting-row"><div class="setting-row-info"><h5>Delete All Meetings</h5><p>Permanently remove all meetings.</p></div><button class="btn-ghost" style="border-color:var(--red);color:var(--red);" onclick="clearAllData()">Delete All</button></div>`;
  }
}

async function saveProfile() {
  const s = getSettings();
  s.profile.username = document.getElementById('sUsername').value.trim();
  const newPass = document.getElementById('sPass').value;
  if (newPass) {
    if (newPass.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
    const { error } = await sb.auth.updateUser({ password: newPass });
    if (error) { toast('Password update failed: ' + error.message, 'error'); return; }
    toast('Password updated!', 'success');
    document.getElementById('sPass').value = '';
  }
  saveSettings(s);
  document.getElementById('sidebarName').innerText = s.profile.username || (_currentUser ? _currentUser.email.split('@')[0] : '');
  toast('Profile saved!', 'success');
}

async function sendPasswordReset() {
  if (!_currentUser) return;
  const { error } = await sb.auth.resetPasswordForEmail(_currentUser.email, { redirectTo: window.location.href });
  if (error) toast('Error: ' + error.message, 'error');
  else       toast('Password reset email sent!', 'success');
}

function saveNotifications() {
  const s = getSettings();
  s.notifications.browser         = document.getElementById('browserToggle').checked;
  s.notifications.reminderMinutes = parseInt(document.getElementById('reminderSlider').value);
  saveSettings(s);
  if (s.notifications.browser) requestBrowserNotificationPermission();
  toast('Notifications saved!', 'success');
}

function saveDefaults() {
  const s = getSettings();
  s.defaults.platform = document.getElementById('defPlatform').value;
  s.defaults.duration = parseInt(document.getElementById('defDuration').value);
  saveSettings(s);
  toast('Defaults saved!', 'success');
}

function saveAvailability() {
  const s = getSettings();
  s.availability.start     = document.getElementById('availStart').value;
  s.availability.end       = document.getElementById('availEnd').value;
  s.availability.buffer    = parseInt(document.getElementById('availBuffer').value);
  s.availability.maxPerDay = parseInt(document.getElementById('availMax').value);
  saveSettings(s);
  toast('Availability saved!', 'success');
}

function changeTheme(theme, el) {
  document.body.className = theme;
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
  const s = getSettings(); s.appearance.theme = theme; saveSettings(s);
  toast('Theme applied!', 'success');
}

function exportData() {
  const data = { meetings: getMeetings(), recurring: getRecurring() };
  const blob = new Blob([JSON.stringify(data,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'meetsync-export.json'; a.click();
  toast('Data exported!', 'success');
}

async function clearAllData() {
  if (!confirm('Permanently delete ALL your meetings? This cannot be undone.')) return;
  await sb.from('meetings').delete().eq('user_id', _currentUser.id);
  await sb.from('recurring').delete().eq('user_id', _currentUser.id);
  _meetings = []; _recurring = [];
  refreshAll();
  toast('All meetings deleted.', 'info');
}

/* ============================================================
   NOTIFICATIONS
============================================================ */
async function requestBrowserNotificationPermission() {
  if (!('Notification' in window)) { toast('Browser does not support notifications.', 'error'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') toast('Browser notifications enabled! ✅', 'success');
  else                    toast('Notification permission denied.', 'error');
}

function sendBrowserNotif(title, body) {
  if (Notification.permission === 'granted') new Notification(title, { body });
}

setInterval(() => {
  if (!_currentUser) return;
  const now         = new Date();
  const currentDay  = now.toLocaleString('default', { weekday:'short' });
  const currentTime = now.toTimeString().slice(0,5);
  const offset      = parseInt(getSettings().notifications.reminderMinutes) || 15;
  getRecurring().forEach(r => {
    if (!r.days.includes(currentDay)) return;
    const [h,m] = r.time.split(':').map(Number);
    const rem = new Date(); rem.setHours(h, m-offset, 0, 0);
    if (currentTime === rem.toTimeString().slice(0,5)) {
      toast(`🔔 "${r.subject}" starts in ${offset} min`, 'info');
      sendBrowserNotif('Upcoming Meeting', `"${r.subject}" starts in ${offset} minutes`);
    }
  });
  getMeetings().forEach(m => {
    if (m.date !== localToday()) return;
    const [h,min] = m.time.split(':').map(Number);
    const rem = new Date(); rem.setHours(h, min-offset, 0, 0);
    if (currentTime === rem.toTimeString().slice(0,5)) {
      toast(`🔔 "${m.subject}" starts in ${offset} min`, 'info');
      sendBrowserNotif('Upcoming Meeting', `"${m.subject}" starts in ${offset} minutes`);
    }
  });
}, 60000);

/* ============================================================
   MODALS
============================================================ */
function openModal(id)  { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

document.querySelectorAll('.modal-backdrop').forEach(m => {
  m.addEventListener('click', function(e) { if (e.target===this) this.classList.remove('show'); });
});

/* ============================================================
   AI ASSISTANT
============================================================ */
function toggleAI() { document.getElementById('aiWindow').classList.toggle('open'); }
function askAI(text) { document.getElementById('aiInput').value = text; processAI(); }

function processAI() {
  const rawInput  = document.getElementById('aiInput').value.trim();
  const input     = rawInput.toLowerCase();
  const body      = document.getElementById('aiBody');
  const meetings  = getMeetings();
  const recurring = getRecurring();
  const today     = localToday();
  const todayDay  = new Date().toLocaleString('default', { weekday:'short' });
  if (!input) return;
  body.innerHTML += `<div class="ai-msg user">${rawInput}</div>`;
  let r = '';
  if (input.includes('today')) {
    const all = [...meetings.filter(m=>m.date===today),...recurring.filter(r=>r.days.includes(todayDay))];
    r = all.length ? `You have <strong>${all.length}</strong> meeting(s) today:<br>`+all.map(m=>`• ${m.subject} at ${m.time}`).join('<br>') : 'No meetings today! 🎉';
  } else if (input.includes('total')||input.includes('all')) {
    r = `You have <strong>${meetings.length+recurring.length}</strong> total — ${meetings.length} one-time, ${recurring.length} recurring.`;
  } else if (input.includes('recurring')) {
    r = recurring.length ? `<strong>${recurring.length}</strong> recurring:<br>`+recurring.map(rr=>`• ${rr.subject} — ${rr.days.join(', ')} at ${rr.time}`).join('<br>') : 'No recurring meetings.';
  } else if (input.includes('next')) {
    const future = meetings.filter(m=>m.date>=today).sort((a,b)=>a.date.localeCompare(b.date));
    r = future.length ? `Next: <strong>${future[0].subject}</strong> on ${future[0].date} at ${future[0].time}` : 'No upcoming meetings.';
  } else {
    r = 'Try: "meetings today", "total meetings", "recurring meetings", or "next meeting".';
  }
  body.innerHTML += `<div class="ai-msg bot">${r}</div>`;
  body.scrollTop  = body.scrollHeight;
  document.getElementById('aiInput').value = '';
}

/* ============================================================
   CORE
============================================================ */
function refreshAll() {
  loadMeetings();
  renderCalendar();
  updateDashboardStats();
}

function initApp() {
  const s = getSettings();
  document.body.className = s.appearance.theme || '';
  // Restore sidebar state
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    document.getElementById('sidebar')?.classList.add('collapsed');
  }
  refreshAll();
  updateClock();
  loadSettings('profile', document.querySelector('.settings-tab'));
}

/* ============================================================
   EXPOSE ALL FUNCTIONS TO GLOBAL SCOPE
   Required so onclick="..." attributes in HTML can call them
============================================================ */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  // Persist preference
  localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
}

window.toggleSidebar = toggleSidebar;
window.toggleMode          = toggleMode;
window.handlePasswordReset = handlePasswordReset;
window.verifyOTP           = verifyOTP;
window.resendOTP           = resendOTP;
window.logout              = logout;
window.setup2FA            = setup2FA;
window.verify2FA           = verify2FA;
window.disable2FA          = disable2FA;
window.showPage            = showPage;
window.openModal           = openModal;
window.closeModal          = closeModal;
window.addMeeting          = addMeeting;
window.loadMeetings        = loadMeetings;
window.openEditModal       = openEditModal;
window.updateMeeting       = updateMeeting;
window.deleteMeeting       = deleteMeeting;
window.createRecurring     = createRecurring;
window.openRecurringEdit   = openRecurringEdit;
window.updateRecurring     = updateRecurring;
window.deleteRecurring     = deleteRecurring;
window.renderCalendar      = renderCalendar;
window.changeMonth         = changeMonth;
window.showMeetingsForDate = showMeetingsForDate;
window.loadSettings        = loadSettings;
window.saveProfile         = saveProfile;
window.sendPasswordReset   = sendPasswordReset;
window.saveNotifications   = saveNotifications;
window.saveDefaults        = saveDefaults;
window.saveAvailability    = saveAvailability;
window.changeTheme         = changeTheme;
window.exportData          = exportData;
window.clearAllData        = clearAllData;
window.toggleAI            = toggleAI;
window.askAI               = askAI;
window.processAI           = processAI;

/* ============================================================
   BOOTSTRAP
============================================================ */
window.onload = async function () {
  // Hide the main shell until we confirm the user is properly logged in
  document.querySelector('.shell').style.display = 'none';

  setInterval(updateClock, 1000);
  updateClock();
  document.getElementById('resetWrap').style.display = 'block';

  // Only restore session if we're NOT in the middle of an OTP flow
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user && !window._pendingEmail) {
    await loginSuccess(session.user);
  }

  sb.auth.onAuthStateChange(async (event, session) => {
    // Ignore SIGNED_IN during OTP flow — verifyOTP() handles that
    if (event === 'SIGNED_IN' && session && !_currentUser && !window._pendingEmail) {
      await loginSuccess(session.user);
    }
    if (event === 'SIGNED_OUT') { _currentUser=null; _meetings=[]; _recurring=[]; }
    if (event === 'PASSWORD_RECOVERY') {
      toast('You can now set a new password in Settings → Security.', 'info');
      if (session) await loginSuccess(session.user);
    }
  });
};
