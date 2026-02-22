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
   SETTINGS — Supabase-synced across all devices
   Flow: save locally → upsert to Supabase → show ✓
         on login → fetch from Supabase → overwrite local → apply
============================================================ */
const DEFAULT_SETTINGS = {
  profile:       { username: '', email: '' },
  notifications: { browser: false, emailReminders: false, reminderMinutes: 15 },
  defaults:      { platform: 'meet', duration: 30 },
  availability:  { start: '09:00', end: '17:00', buffer: 0, maxPerDay: 10 },
  appearance:    { theme: '' },
  security:      { otpEnabled: true }
};

function mergeWithDefaults(raw) {
  return {
    profile:       { ...DEFAULT_SETTINGS.profile,       ...(raw?.profile       || {}) },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(raw?.notifications || {}) },
    defaults:      { ...DEFAULT_SETTINGS.defaults,      ...(raw?.defaults      || {}) },
    availability:  { ...DEFAULT_SETTINGS.availability,  ...(raw?.availability  || {}) },
    appearance:    { ...DEFAULT_SETTINGS.appearance,    ...(raw?.appearance    || {}) },
    security:      { ...DEFAULT_SETTINGS.security,      ...(raw?.security      || {}) },
  };
}

function getSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem('settings') || 'null');
    return mergeWithDefaults(raw);
  } catch { return mergeWithDefaults(null); }
}

/* Save locally first (instant), then push to Supabase */
async function saveSettings(s, toastMsg = null) {
  localStorage.setItem('settings', JSON.stringify(s));
  applySettingsToUI(s);

  if (!_currentUser) return;
  try {
    const { error } = await sb.from('user_settings').upsert(
      { user_id: _currentUser.id, settings: s, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) throw error;
    if (toastMsg) toast(toastMsg, 'success');
  } catch (e) {
    console.warn('Settings sync failed:', e.message);
    if (toastMsg) toast(toastMsg + ' (saved locally)', 'success');
  }
}

/* Pull from Supabase and overwrite local — called on every login */
async function loadSettingsFromSupabase() {
  if (!_currentUser) return;
  try {
    const { data, error } = await sb
      .from('user_settings')
      .select('settings')
      .eq('user_id', _currentUser.id)
      .single();

    if (error || !data?.settings) return; // first-time user, no remote settings yet

    const merged = mergeWithDefaults(data.settings);
    localStorage.setItem('settings', JSON.stringify(merged));
    return merged;
  } catch (e) {
    console.warn('Could not load settings from Supabase:', e.message);
  }
}

/* Apply loaded settings to the live UI (sidebar name, theme, etc.) */
function applySettingsToUI(s) {
  // Theme
  document.body.className = s.appearance?.theme || '';

  // Sidebar display name — prefer saved username, fall back to email prefix
  const name = s.profile?.username || (_currentUser?.email?.split('@')[0] || '');
  const nameEl   = document.getElementById('sidebarName');
  const avatarEl = document.getElementById('sidebarAvatar');
  if (nameEl   && name) nameEl.innerText   = name;
  if (avatarEl && name) avatarEl.innerText = name.charAt(0).toUpperCase();
}

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

function showLoading(text = 'Please wait…') {
  document.getElementById('loadingText').innerText = text;
  document.getElementById('loadingOverlay').classList.add('show');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
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

let _authInProgress = false;

async function handleAuth() {
  if (_authInProgress) return; // prevent double-tap / multiple OTPs

  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value.trim();
  const confirm  = document.getElementById('confirmPassword').value.trim();
  const msg      = document.getElementById('authMessage');

  if (!email || !password) {
    msg.innerText = 'Please fill in all fields.';
    msg.className = 'auth-message msg-error';
    return;
  }

  _authInProgress = true;
  setAuthLoading(true);
  showLoading(_isSignup ? 'Creating your account…' : 'Signing in…');

  if (_isSignup) {
    if (password !== confirm) {
      msg.innerText = 'Passwords do not match.';
      msg.className = 'auth-message msg-error';
      setAuthLoading(false); hideLoading(); _authInProgress = false;
      return;
    }
    if (password.length < 6) {
      msg.innerText = 'Password must be at least 6 characters.';
      msg.className = 'auth-message msg-error';
      setAuthLoading(false); hideLoading(); _authInProgress = false;
      return;
    }
    const { error } = await sb.auth.signUp({ email, password });
    setAuthLoading(false); hideLoading(); _authInProgress = false;
    if (error) { msg.innerText = error.message; msg.className = 'auth-message msg-error'; return; }
    msg.innerText = '✅ Account created! Sign in below.';
    msg.className = 'auth-message msg-success';
    toggleMode();
    return;
  }

  // Check if user has OTP enabled (default: ON) — read from Supabase settings
  const localOtpEnabled = (getSettings().security?.otpEnabled) !== false;

  if (!localOtpEnabled) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    setAuthLoading(false); hideLoading(); _authInProgress = false;
    if (error) {
      msg.innerText = 'Invalid email or password.';
      msg.className = 'auth-message msg-error';
      return;
    }
    await loginSuccess(data.user);
    return;
  }

  // OTP flow — mark pending so onAuthStateChange ignores the SIGNED_IN event
  window._pendingEmail = email;

  showLoading('Verifying password…');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    window._pendingEmail = null;
    msg.innerText = 'Invalid email or password.';
    msg.className = 'auth-message msg-error';
    setAuthLoading(false); hideLoading(); _authInProgress = false;
    return;
  }

  showLoading('Sending verification code…');
  await sb.auth.signOut();
  const { error: otpError } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false }
  });

  setAuthLoading(false); hideLoading(); _authInProgress = false;

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

  // Show shell immediately with email prefix — will update below
  const displayName =
  user.user_metadata?.display_name ||
  getSettings().profile?.username ||
  user.email.split('@')[0];

document.getElementById('sidebarName').innerText = displayName;
document.getElementById('sidebarAvatar').innerText =
  displayName.charAt(0).toUpperCase();
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('otpScreen').style.display   = 'none';
  document.querySelector('.shell').style.display       = 'flex';
  document.getElementById('sidebarAvatar').innerText   = emailPrefix.charAt(0).toUpperCase();

  // Pull latest settings from Supabase (overwrites local if remote exists)
  await loadSettingsFromSupabase();

  // Seed email into profile if first login
  const s = getSettings();
  if (!s.profile.email) {
    s.profile.email = user.email;
    await saveSettings(s);
  }

  // Apply everything — theme, username in sidebar, etc.
  applySettingsToUI(s);

  await fetchAllData();
  initApp();
  hideLoading();
}

async function logout() {
  await sb.auth.signOut();
  _currentUser       = null;
  _meetings          = [];
  _recurring         = [];
  window._pendingEmail = null; // ← critical fix: was blocking re-login
  // Hide shell, show login
  document.querySelector('.shell').style.display        = 'none';
  document.getElementById('loginScreen').style.display  = 'flex';
  document.getElementById('otpScreen').style.display    = 'none';
  document.getElementById('authEmail').value            = '';
  document.getElementById('authPassword').value         = '';
  document.getElementById('authMessage').innerText      = '';
  document.getElementById('authMessage').className      = 'auth-message';
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

  console.log("Current user ID:", _currentUser.id);

  const [{ data: m, error: e1 }, { data: r, error: e2 }] = await Promise.all([
    sb.from('meetings')
      .select('*')
      .eq('user_id', _currentUser.id)
      .order('date')
      .order('time'),

    sb.from('recurring')
      .select('*')
      .eq('user_id', _currentUser.id)
      .order('created_at')
  ]);

  console.log("Meetings fetched:", m);

  if (e1) console.error('Meetings fetch error:', e1.message);
  else _meetings = m || [];

  if (e2) console.error('Recurring fetch error:', e2.message);
  else _recurring = r || [];
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
  let name = '';

if (_currentUser) {
  name =
    _currentUser.user_metadata?.display_name ||
    getSettings().profile?.username ||
    _currentUser.email.split('@')[0];
}
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
      <div class="form-group mb-4"><label class="form-label">Display Name</label><input class="form-control" id="sUsername" value="${s.profile.username||''}" placeholder="Your name"></div>
      <div class="form-group mb-4"><label class="form-label">Email Address</label><input class="form-control" id="sEmail" type="email" value="${email||''}" disabled style="opacity:0.6;cursor:not-allowed;"></div>
      <p style="font-size:12px;color:var(--text-3);margin-bottom:20px;">Email is managed by Supabase Auth and cannot be changed here.</p>
      <div class="form-group mb-4"><label class="form-label">New Password</label><input class="form-control" id="sPass" type="password" placeholder="Leave blank to keep current password"></div>
      <button class="btn-accent" onclick="saveProfile()">Save Changes</button>`;

  } else if (section === 'security') {
    const otpEnabled = s.security?.otpEnabled !== false; // default ON
    c.innerHTML = `<h3>Security</h3><p class="desc">Manage account security settings.</p>
      <div class="setting-row">
        <div class="setting-row-info">
          <h5>Email OTP Verification</h5>
          <p>Require a one-time code sent to your email each time you sign in.</p>
        </div>
        <label class="toggle otp-toggle" title="${otpEnabled?'Click to disable':'Click to enable'}">
          <input type="checkbox" id="otpToggle" ${otpEnabled?'checked':''} onchange="toggleOTPSetting(this.checked)">
          <div class="toggle-track"></div>
        </label>
      </div>
      <div id="otpStatusMsg" style="font-size:12px;color:var(--text-3);padding:8px 0 4px;margin-bottom:4px;">
        ${otpEnabled
          ? '✅ OTP is active — you will receive a verification code by email each login.'
          : '⚠️ OTP is disabled — you sign in with password only. Less secure.'}
      </div>
      <div class="setting-row" style="margin-top:10px;">
        <div class="setting-row-info"><h5>Password Reset</h5><p>Send a password reset link to your email.</p></div>
        <button class="btn-ghost" onclick="sendPasswordReset()">Send Email</button>
      </div>`;

  } else if (section === 'notifications') {
    c.innerHTML = `<h3>Notifications</h3><p class="desc">Configure how you get reminded about meetings.</p>
      <div class="setting-row">
        <div class="setting-row-info">
          <h5>Browser Notifications</h5>
          <p>Pop-up alerts outside the browser tab when meetings are about to start.</p>
        </div>
        <label class="toggle"><input type="checkbox" id="browserToggle" ${s.notifications?.browser?'checked':''}><div class="toggle-track"></div></label>
      </div>
      <div class="setting-row">
        <div class="setting-row-info">
          <h5>In-App Sound Alert</h5>
          <p>Play an audio beep and show a banner inside MeetSync before meetings start. Keep this tab open for reminders to fire.</p>
        </div>
        <label class="toggle"><input type="checkbox" id="emailNotifToggle" ${s.notifications?.emailReminders?'checked':''}><div class="toggle-track"></div></label>
      </div>
      <div class="range-wrap">
        <div class="range-header"><span>Remind me this many minutes before</span><span id="reminderVal">${s.notifications?.reminderMinutes||15} min</span></div>
        <input type="range" id="reminderSlider" min="5" max="60" value="${s.notifications?.reminderMinutes||15}" oninput="document.getElementById('reminderVal').innerText=this.value+' min'">
      </div>
      <button class="btn-accent" onclick="saveNotifications()">Save Notifications</button>
      <p style="margin-top:14px;font-size:11px;color:var(--text-3);">💡 To receive reminders, keep this tab open. Browser notifications work even when the tab is in the background.</p>`;

  } else if (section === 'defaults') {
    c.innerHTML = `<h3>Meeting Defaults</h3><p class="desc">Set default options for new meetings.</p>
      <div class="form-group mb-4"><label class="form-label">Default Platform</label>
        <select class="form-control" id="defPlatform">
          <option value="meet" ${s.defaults?.platform==='meet'?'selected':''}>Google Meet</option>
          <option value="zoom" ${s.defaults?.platform==='zoom'?'selected':''}>Zoom</option>
          <option value="jitsi" ${s.defaults?.platform==='jitsi'?'selected':''}>Jitsi</option>
        </select></div>
      <div class="form-group mb-4"><label class="form-label">Default Duration</label>
        <select class="form-control" id="defDuration">
          <option value="15" ${s.defaults?.duration===15?'selected':''}>15 Minutes</option>
          <option value="30" ${s.defaults?.duration===30?'selected':''}>30 Minutes</option>
          <option value="60" ${s.defaults?.duration===60?'selected':''}>1 Hour</option>
        </select></div>
      <button class="btn-accent" onclick="saveDefaults()">Save Defaults</button>`;

  } else if (section === 'availability') {
    c.innerHTML = `<h3>Availability</h3><p class="desc">Define your working hours and meeting limits.</p>
      <div class="form-grid">
        <div class="form-group"><label class="form-label">Start Time</label><input class="form-control" type="time" id="availStart" value="${s.availability?.start||'09:00'}"></div>
        <div class="form-group"><label class="form-label">End Time</label><input class="form-control" type="time" id="availEnd" value="${s.availability?.end||'17:00'}"></div>
        <div class="form-group"><label class="form-label">Buffer Between Meetings (min)</label><input class="form-control" type="number" id="availBuffer" value="${s.availability?.buffer||0}" min="0" max="60"></div>
        <div class="form-group"><label class="form-label">Max Meetings / Day</label><input class="form-control" type="number" id="availMax" value="${s.availability?.maxPerDay||10}" min="1" max="20"></div>
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
    c.innerHTML = `<h3>Appearance</h3><p class="desc">Customize your workspace look and feel.</p>
      <div class="theme-grid">
        ${themes.map(t=>`<div class="theme-swatch ${s.appearance?.theme===t.id?'active':''}" style="background:${t.bg}" onclick="changeTheme('${t.id}',this)"><span>${t.label}</span></div>`).join('')}
      </div>`;

  } else if (section === 'data') {
    c.innerHTML = `<h3>Data & Privacy</h3><p class="desc">Manage your stored data and account.</p>
      <div class="setting-row">
        <div class="setting-row-info"><h5>Export All Data</h5><p>Download all your meetings as a JSON file.</p></div>
        <button class="btn-ghost" onclick="exportData()">⬇ Export</button>
      </div>
      <div class="setting-row">
        <div class="setting-row-info"><h5>Delete All Meetings</h5><p>Permanently remove all one-time and recurring meetings.</p></div>
        <button class="btn-ghost" style="border-color:var(--red);color:var(--red);" onclick="clearAllData()">🗑 Delete All</button>
      </div>
      <div class="setting-row" style="margin-top:8px;">
        <div class="setting-row-info"><h5>Sign Out</h5><p>Log out of your MeetSync account on this device.</p></div>
        <button class="btn-ghost" style="border-color:var(--red);color:var(--red);" onclick="logout()">↩ Sign Out</button>
      </div>`;
  }
}

async function saveProfile() {
  const s = getSettings();
  const newName = document.getElementById('sUsername').value.trim();
  const newPass = document.getElementById('sPass').value;

 s.profile.username = newName;

if (newName) {
  const { error } = await sb.auth.updateUser({
    data: { display_name: newName }
  });
  if (error) {
    toast('Could not update display name in auth: ' + error.message, 'error');
  }
}

  if (newPass) {
    if (newPass.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }
    const { error } = await sb.auth.updateUser({ password: newPass });
    if (error) { toast('Password update failed: ' + error.message, 'error'); return; }
    document.getElementById('sPass').value = '';
    toast('Password updated!', 'success');
  }

  await saveSettings(s, 'Profile saved!');
}

async function sendPasswordReset() {
  if (!_currentUser) return;
  const { error } = await sb.auth.resetPasswordForEmail(_currentUser.email, { redirectTo: window.location.href });
  if (error) toast('Error: ' + error.message, 'error');
  else       toast('Password reset email sent!', 'success');
}

async function saveNotifications() {
  const s = getSettings();
  if (!s.notifications) s.notifications = {};
  s.notifications.browser         = document.getElementById('browserToggle').checked;
  s.notifications.emailReminders  = document.getElementById('emailNotifToggle').checked;
  s.notifications.reminderMinutes = parseInt(document.getElementById('reminderSlider').value);
  if (s.notifications.browser) requestBrowserNotificationPermission();
  await saveSettings(s, 'Notifications saved!');
}

async function saveDefaults() {
  const s = getSettings();
  s.defaults.platform = document.getElementById('defPlatform').value;
  s.defaults.duration = parseInt(document.getElementById('defDuration').value);
  await saveSettings(s, 'Defaults saved!');
}

async function saveAvailability() {
  const s = getSettings();
  s.availability.start     = document.getElementById('availStart').value;
  s.availability.end       = document.getElementById('availEnd').value;
  s.availability.buffer    = parseInt(document.getElementById('availBuffer').value);
  s.availability.maxPerDay = parseInt(document.getElementById('availMax').value);
  await saveSettings(s, 'Availability saved!');
}

async function changeTheme(theme, el) {
  document.body.className = theme;
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
  const s = getSettings();
  s.appearance.theme = theme;
  await saveSettings(s, 'Theme applied!');
}

async function toggleOTPSetting(enabled) {
  const s = getSettings();
  if (!s.security) s.security = {};
  s.security.otpEnabled = enabled;
  const msg = document.getElementById('otpStatusMsg');
  if (msg) {
    msg.innerText = enabled
      ? '✅ OTP is active — you will receive a verification code by email each login.'
      : '⚠️ OTP is disabled — you sign in with password only. Less secure.';
  }
  await saveSettings(s, enabled ? 'OTP verification enabled' : 'OTP verification disabled');
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
   NOTIFICATIONS — Meeting reminders
============================================================ */
async function requestBrowserNotificationPermission() {
  if (!('Notification' in window)) { toast('Browser does not support notifications.', 'error'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') toast('Browser notifications enabled! ✅', 'success');
  else                    toast('Notification permission denied.', 'error');
}

function sendBrowserNotif(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '⚡' });
  }
}

// Track which reminders we've already fired this session (key = "subject|date|time")
const _firedReminders = new Set();

function checkMeetingReminders() {
  if (!_currentUser) return;
  const s = getSettings();
  const offset = parseInt(s.notifications?.reminderMinutes) || 15;
  const browserOn = s.notifications?.browser;

  const now = new Date();
  const currentDay = now.toLocaleString('default', { weekday: 'short' });
  const nowMins = now.getHours() * 60 + now.getMinutes();

  function fireReminder(subject, meetingTimeStr, key) {
    if (_firedReminders.has(key)) return;
    _firedReminders.add(key);

    // Big in-app toast
    toast(`🔔 <strong>${subject}</strong> starts in ${offset} min`, 'info');

    // Browser notification
    if (browserOn) {
      sendBrowserNotif('⚡ MeetSync Reminder', `"${subject}" starts in ${offset} minutes`);
    }

    // Play a subtle beep using Web Audio
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.15, 0.30].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.18, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.25);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.25);
      });
    } catch (_) { /* audio not supported */ }
  }

  // Check one-time meetings
  getMeetings().forEach(m => {
    if (m.date !== localToday()) return;
    const [h, min] = m.time.split(':').map(Number);
    const meetMins = h * 60 + min;
    const reminderMins = meetMins - offset;
    // Fire if we're within the current minute of the reminder time
    if (nowMins === reminderMins) {
      fireReminder(m.subject, m.time, `${m.subject}|${m.date}|${m.time}`);
    }
  });

  // Check recurring meetings
  getRecurring().forEach(r => {
    if (!r.days.includes(currentDay)) return;
    const [h, min] = r.time.split(':').map(Number);
    const meetMins = h * 60 + min;
    const reminderMins = meetMins - offset;
    if (nowMins === reminderMins) {
      fireReminder(r.subject, r.time, `${r.subject}|${currentDay}|${r.time}`);
    }
  });
}

// Check every 30 seconds for tighter accuracy (within the right minute)
setInterval(checkMeetingReminders, 30000);

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
  applySettingsToUI(s);

  // Restore sidebar collapsed state
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    document.getElementById('sidebar')?.classList.add('collapsed');
  }

  refreshAll();
  updateClock();
  loadSettings('profile', document.querySelector('.settings-tab'));
}

// Re-sync settings when user returns to this tab (picks up changes from other devices)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && _currentUser) {
    await loadSettingsFromSupabase();
    applySettingsToUI(getSettings());
  }
});

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

window.toggleOTPSetting    = toggleOTPSetting;
window.toggleSidebar       = toggleSidebar;
window.handleAuth          = handleAuth;
window.showLoading         = showLoading;
window.hideLoading         = hideLoading;
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
window.sb = sb;
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
