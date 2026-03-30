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

  // Sign in with password — session is used directly (no OTP detour)
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  setAuthLoading(false); hideLoading(); _authInProgress = false;

  if (error) {
    msg.innerText = 'Invalid email or password.';
    msg.className = 'auth-message msg-error';
    return;
  }

  await loginSuccess(data.user);
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

  // Show shell immediately with a display name
  const displayName = user.user_metadata?.display_name
    || getSettings().profile?.username
    || user.email.split('@')[0];

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('otpScreen').style.display   = 'none';
  document.querySelector('.shell').style.display       = 'flex';
  document.getElementById('sidebarName').innerText     = displayName;
  document.getElementById('sidebarAvatar').innerText   = displayName.charAt(0).toUpperCase();

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
   ⚠️  If meetings return empty, run this SQL in Supabase SQL Editor:

   ALTER TABLE meetings      ENABLE ROW LEVEL SECURITY;
   ALTER TABLE recurring     ENABLE ROW LEVEL SECURITY;
   ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Users manage own meetings"
     ON meetings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

   CREATE POLICY "Users manage own recurring"
     ON recurring FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

   CREATE POLICY "Users manage own settings"
     ON user_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
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
  if (id === 'analytics')   updateAnalytics();
  if (id === 'settings')    loadSettings('profile', document.querySelector('.settings-tab'));
  if (id === 'meetings')    loadMeetings();
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
  const botEnabled = document.getElementById('botEnabled').checked;
  if (!subject || !date || !time || !platform || !code) {
    toast('Please fill in all required fields.', 'error'); return;
  }
  const { data, error } = await sb.from('meetings').insert({
    user_id: _currentUser.id, subject, date, time, platform, code,
    link: buildLink(platform, code), notes, bot_enabled: botEnabled
  }).select().single();
  if (error) { toast('Error saving meeting: ' + error.message, 'error'); return; }
  _meetings.push(data);
  closeModal('meetingModal');
  ['subject','code','notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('date').value = '';
  document.getElementById('time').value = '';
  document.getElementById('botEnabled').checked = false;
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
            ${m.bot_enabled ? '<span class="meeting-badge badge-bot">🤖 Bot ON</span>' : ''}
          </div>
        </div>
        <div class="meeting-actions">
          <button class="icon-btn ${m.bot_enabled?'bot-active':'bot-inactive'}" onclick="toggleBotEnabled('${m.id}', ${!m.bot_enabled})" title="${m.bot_enabled?'Disable bot':'Enable bot'}">🤖</button>
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
  document.getElementById('editSubject').value      = m.subject;
  document.getElementById('editDate').value         = m.date;
  document.getElementById('editTime').value         = m.time;
  document.getElementById('editPlatform').value     = m.platform;
  document.getElementById('editCode').value         = m.code;
  document.getElementById('editIndex').value        = id;
  document.getElementById('editBotEnabled').checked = !!m.bot_enabled;
  openModal('editModal');
}

async function updateMeeting() {
  const id       = document.getElementById('editIndex').value;
  const platform = document.getElementById('editPlatform').value;
  const code     = document.getElementById('editCode').value.trim();
  const updates  = {
    subject:     document.getElementById('editSubject').value.trim(),
    date:        document.getElementById('editDate').value,
    time:        document.getElementById('editTime').value,
    platform, code, link: buildLink(platform, code),
    bot_enabled: document.getElementById('editBotEnabled').checked
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

async function toggleBotEnabled(id, enable) {
  const { data, error } = await sb.from('meetings')
    .update({ bot_enabled: enable })
    .eq('id', id).select().single();
  if (error) { toast('Error updating bot setting.', 'error'); return; }
  _meetings = _meetings.map(m => m.id === id ? data : m);
  loadMeetings();
  toast(enable ? '🤖 Ghost Bot enabled for this meeting' : '🤖 Ghost Bot disabled', enable ? 'success' : 'info');
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
   AI ASSISTANT — Smart Local NLP Engine v2
   + Conversation memory, voice input, conflict detection,
     free slot finder, reschedule, filter by platform,
     past meetings, timestamps, copy button, clear chat
============================================================ */

// Conversation memory
let _aiHistory    = [];
let _aiLastIntent = null;
let _aiLastResult = null;

// ── Open / close
function toggleAI() {
  const win = document.getElementById('aiWindow');
  win.classList.toggle('open');
  if (win.classList.contains('open')) {
    document.getElementById('aiInput').focus();
    aiUpdateSuggestions();
  }
}

// ── Clear chat
function aiClearChat() {
  _aiHistory = []; _aiLastIntent = null; _aiLastResult = null;
  document.getElementById('aiBody').innerHTML =
    '<div class="ai-msg bot">Chat cleared! 👋 What do you need?</div>';
}

// ── Chip shortcut
function askAI(text) {
  document.getElementById('aiInput').value = text;
  processAI();
}

// ── Voice input
let _aiListening = false;
function aiVoiceInput() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    toast('Voice input not supported. Try Chrome.', 'error'); return;
  }
  const btn = document.getElementById('aiVoiceBtn');
  const SR  = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-US'; rec.interimResults = false;
  if (_aiListening) { rec.stop(); return; }
  _aiListening = true;
  btn.classList.add('listening');
  rec.start();
  rec.onresult = e => {
    document.getElementById('aiInput').value = e.results[0][0].transcript;
    processAI();
  };
  rec.onend = () => { _aiListening = false; btn.classList.remove('listening'); };
  rec.onerror = () => { _aiListening = false; btn.classList.remove('listening'); toast('Could not hear. Try again.', 'error'); };
}

// ── Typing indicator
function aiShowTyping() {
  const body = document.getElementById('aiBody');
  const el = document.createElement('div');
  el.className = 'ai-msg bot ai-typing'; el.id = 'aiTyping';
  el.innerHTML = '<span></span><span></span><span></span>';
  body.appendChild(el); body.scrollTop = body.scrollHeight;
}
function aiHideTyping() { document.getElementById('aiTyping')?.remove(); }

// ── Timestamp helper
function aiTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Append bot message with actions + timestamp + copy button
function aiBotMsg(html, actions = []) {
  const body = document.getElementById('aiBody');
  const el   = document.createElement('div');
  el.className = 'ai-msg bot';

  const content = document.createElement('div');
  content.className = 'ai-msg-content';
  content.innerHTML = html;
  el.appendChild(content);

  // Action buttons
  if (actions.length) {
    const bar = document.createElement('div');
    bar.className = 'ai-action-bar';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.className = 'ai-action-btn';
      btn.textContent = a.label;
      btn.onclick = a.fn;
      bar.appendChild(btn);
    });
    el.appendChild(bar);
  }

  // Footer: timestamp + copy
  const footer = document.createElement('div');
  footer.className = 'ai-msg-footer';
  footer.innerHTML = `
    <span class="ai-ts">${aiTimestamp()}</span>
    <button class="ai-copy-btn" title="Copy" onclick="aiCopyMsg(this)">⎘</button>
  `;
  el.appendChild(footer);

  body.appendChild(el);
  body.scrollTop = body.scrollHeight;

  // Save to history
  _aiHistory.push({ role: 'bot', text: html.replace(/<[^>]+>/g, ''), time: Date.now() });
}

// ── Copy message text
function aiCopyMsg(btn) {
  const text = btn.closest('.ai-msg').querySelector('.ai-msg-content').innerText;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = '⎘', 1500);
  });
}

// ── Dynamic suggestion chips
function aiUpdateSuggestions() {
  const meetings  = getMeetings();
  const recurring = getRecurring();
  const today     = localToday();
  const todayDay  = new Date().toLocaleString('default', { weekday: 'short' });
  const todayCount = meetings.filter(m => m.date === today).length +
                     recurring.filter(r => r.days.includes(todayDay)).length;
  const nextUp = meetings.filter(m => m.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const chips = [
    { label: `📅 Today (${todayCount})`,    text: 'what meetings do I have today' },
    { label: '⏭ Next meeting',             text: 'when is my next meeting' },
    { label: '🔄 Recurring',               text: 'show my recurring meetings' },
    { label: '📊 Summary',                 text: 'give me a summary' },
    { label: '🕒 Free slots today',        text: 'when am I free today' },
    { label: '📅 This week',               text: 'meetings this week' },
    { label: '🔍 Filter by Zoom',          text: 'show all zoom meetings' },
    { label: '➕ Schedule',                text: 'schedule a new meeting' },
    { label: '🗑 Delete',                  text: 'delete a meeting' },
    { label: '📆 Calendar',               text: 'open the calendar' },
    { label: '⚙️ Settings',              text: 'open settings' },
    { label: nextUp ? `▶ Join ${nextUp.subject}` : '▶ Join next', text: 'join my next meeting' },
    { label: '📋 Past meetings',          text: 'show my past meetings' },
    { label: '📈 Busiest day',            text: 'what is my busiest day' },
    { label: '🗑 Clear chat',             text: '__clear__' },
  ];
  const wrap = document.getElementById('aiSuggestions');
  if (!wrap) return;
  wrap.innerHTML = chips.map(c =>
    c.text === '__clear__'
      ? `<span class="ai-chip ai-chip-danger" onclick="aiClearChat()">${c.label}</span>`
      : `<span class="ai-chip" onclick="askAI(${JSON.stringify(c.text)})">${c.label}</span>`
  ).join('');
}

// ── NLP helpers
function nlpHas(input, ...words) { return words.some(w => input.includes(w)); }

function nlpExtractTime(input) {
  const m = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function nlpExtractDate(input) {
  const today = new Date();
  if (nlpHas(input, 'today'))      return localToday();
  if (nlpHas(input, 'tomorrow'))   { const d = new Date(today); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  if (nlpHas(input, 'yesterday'))  { const d = new Date(today); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  if (nlpHas(input, 'monday',   'mon')) return nlpNextWeekday(1);
  if (nlpHas(input, 'tuesday',  'tue')) return nlpNextWeekday(2);
  if (nlpHas(input, 'wednesday','wed')) return nlpNextWeekday(3);
  if (nlpHas(input, 'thursday', 'thu')) return nlpNextWeekday(4);
  if (nlpHas(input, 'friday',   'fri')) return nlpNextWeekday(5);
  if (nlpHas(input, 'saturday', 'sat')) return nlpNextWeekday(6);
  if (nlpHas(input, 'sunday',   'sun')) return nlpNextWeekday(0);
  if (nlpHas(input, 'next week'))  { const d = new Date(today); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }
  return null;
}

function nlpNextWeekday(target) {
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function nlpExtractPlatform(input) {
  if (nlpHas(input, 'zoom'))  return 'zoom';
  if (nlpHas(input, 'jitsi')) return 'jitsi';
  return 'meet';
}

function nlpFindMeeting(input) {
  const all = [...getMeetings(), ...getRecurring()];
  return all.find(m => m.subject && input.includes(m.subject.toLowerCase())) ||
         all.find(m => m.subject && m.subject.toLowerCase().split(' ').some(w => w.length > 3 && input.includes(w)));
}

// ── Check for scheduling conflicts
function nlpCheckConflict(date, time) {
  const meetings = getMeetings();
  const [h, min] = time.split(':').map(Number);
  const newStart = h * 60 + min;
  return meetings.find(m => {
    if (m.date !== date) return false;
    const [mh, mm] = m.time.split(':').map(Number);
    const mStart = mh * 60 + mm;
    return Math.abs(newStart - mStart) < 30;
  });
}

// ── Find free slots in a day
function nlpFreeSlots(date) {
  const s = getSettings();
  const dayStart  = (s.availability?.start || '09:00').split(':').map(Number);
  const dayEnd    = (s.availability?.end   || '17:00').split(':').map(Number);
  const buffer    = parseInt(s.availability?.buffer || 0);
  const startMins = dayStart[0] * 60 + dayStart[1];
  const endMins   = dayEnd[0]   * 60 + dayEnd[1];

  const dayMeetings = getMeetings()
    .filter(m => m.date === date)
    .map(m => { const [h, min] = m.time.split(':').map(Number); return h * 60 + min; })
    .sort((a, b) => a - b);

  const slots = [];
  let cursor = startMins;
  for (const mt of dayMeetings) {
    if (mt - cursor >= 30) {
      const sh = Math.floor(cursor / 60), sm = cursor % 60;
      const eh = Math.floor((mt - buffer) / 60), em = (mt - buffer) % 60;
      slots.push(`${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')} – ${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`);
    }
    cursor = mt + 30 + buffer;
  }
  if (endMins - cursor >= 30) {
    const sh = Math.floor(cursor / 60), sm = cursor % 60;
    const eh = Math.floor(endMins / 60), em = endMins % 60;
    slots.push(`${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')} – ${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`);
  }
  return slots;
}

// ── Page action executor
function aiAction(action, payload = {}) {
  switch (action) {
    case 'navigate':
      toggleAI();
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      const navBtn = document.getElementById(`nav-${payload.page}`);
      const page   = document.getElementById(payload.page);
      if (navBtn) navBtn.classList.add('active');
      if (page)   page.classList.add('active');
      if (payload.page === 'analytics') updateAnalytics();
      break;
    case 'open-new-meeting':
      toggleAI();
      showPage('dashboard', document.getElementById('nav-dashboard'));
      setTimeout(() => openModal('meetingModal'), 300);
      break;
    case 'prefill-meeting':
      toggleAI();
      showPage('dashboard', document.getElementById('nav-dashboard'));
      setTimeout(() => {
        openModal('meetingModal');
        if (payload.subject)  document.getElementById('subject').value  = payload.subject;
        if (payload.date)     document.getElementById('date').value     = payload.date;
        if (payload.time)     document.getElementById('time').value     = payload.time;
        if (payload.platform) document.getElementById('platform').value = payload.platform;
      }, 300);
      break;
    case 'join-meeting':
      if (payload.link) window.open(payload.link, '_blank');
      break;
    case 'open-settings':
      toggleAI();
      showPage('settings', document.getElementById('nav-settings'));
      if (payload.tab) setTimeout(() => loadSettings(payload.tab, document.querySelector(`.settings-tab[onclick*="${payload.tab}"]`)), 200);
      break;
  }
}

// ── Main NLP processor
async function processAI() {
  const rawInput = document.getElementById('aiInput').value.trim();
  if (!rawInput) return;
  const input = rawInput.toLowerCase();
  const body  = document.getElementById('aiBody');

  // User message with timestamp
  const userEl = document.createElement('div');
  userEl.className = 'ai-msg user';
  userEl.innerHTML = `
    <div class="ai-msg-content">${rawInput}</div>
    <div class="ai-msg-footer">
      <span class="ai-ts">${aiTimestamp()}</span>
      <button class="ai-copy-btn" title="Copy" onclick="aiCopyMsg(this)">⎘</button>
    </div>`;
  body.appendChild(userEl);
  body.scrollTop = body.scrollHeight;
  document.getElementById('aiInput').value = '';

  // Save to history
  _aiHistory.push({ role: 'user', text: rawInput, time: Date.now() });

  // Thinking delay
  aiShowTyping();
  await new Promise(r => setTimeout(r, 380 + Math.random() * 280));
  aiHideTyping();

  const meetings  = getMeetings();
  const recurring = getRecurring();
  const today     = localToday();
  const todayDay  = new Date().toLocaleString('default', { weekday: 'short' });
  const s         = getSettings();
  const userName  = s.profile?.username || _currentUser?.email?.split('@')[0] || 'there';

  // ── Context follow-ups ("that", "it", "same one", "reschedule it")
  if (_aiLastResult && nlpHas(input, 'that', 'it', 'same', 'this one', 'reschedule it', 'delete it', 'join it')) {
    const m = _aiLastResult;
    if (nlpHas(input, 'join')) {
      aiAction('join-meeting', { link: m.link || buildLink(m.platform, m.code) });
      aiBotMsg(`Opening <strong>${m.subject}</strong>! 🚀`);
      return;
    }
    if (nlpHas(input, 'delete', 'remove', 'cancel')) {
      aiBotMsg(`Delete <strong>${m.subject}</strong>?`, [
        { label: '🗑 Yes, delete', fn: () => {
            m.days ? deleteRecurring(m.id) : deleteMeeting(m.id);
            aiBotMsg(`✅ <strong>${m.subject}</strong> deleted.`);
            _aiLastResult = null;
        }},
        { label: 'Cancel', fn: () => aiBotMsg('Keeping it!') }
      ]);
      return;
    }
    if (nlpHas(input, 'reschedule', 'move', 'change time')) {
      const newDate = nlpExtractDate(input);
      const newTime = nlpExtractTime(input);
      if (!m.days && (newDate || newTime)) {
        const conflict = nlpCheckConflict(newDate || m.date, newTime || m.time);
        if (conflict && conflict.id !== m.id) {
          aiBotMsg(`⚠️ You already have <strong>${conflict.subject}</strong> around that time. Reschedule anyway?`, [
            { label: 'Yes, reschedule', fn: () => rescheduleViaAI(m, newDate, newTime) },
            { label: 'Cancel', fn: () => aiBotMsg('Okay, not rescheduling.') }
          ]);
        } else {
          rescheduleViaAI(m, newDate, newTime);
        }
      } else {
        aiBotMsg(`Got it! I'll open the edit form for <strong>${m.subject}</strong>.`, [
          { label: '✏️ Edit', fn: () => { toggleAI(); openEditModal(m.id); } }
        ]);
      }
      return;
    }
  }

  // ── INTENT: Greetings
  if (nlpHas(input, 'hello','hi','hey','sup','yo','good morning','good afternoon','good evening')) {
    const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    aiBotMsg(`${greet}, ${userName}! 👋 I can schedule meetings, find info, join calls, and control the app. What do you need?`);
    return;
  }

  // ── INTENT: Help
  if (nlpHas(input, 'help','what can you','capabilities','commands')) {
    aiBotMsg(`Here's everything I can do:<br><br>
      <strong>📋 Info</strong><br>
      • "Meetings today / this week / last Monday"<br>
      • "When is my next meeting?"<br>
      • "Show all Zoom / Meet / Jitsi meetings"<br>
      • "When am I free today?"<br>
      • "What's my busiest day?"<br>
      • "Show past meetings"<br><br>
      <strong>⚡ Actions</strong><br>
      • "Schedule a meeting tomorrow at 3pm"<br>
      • "Reschedule my standup to 10am"<br>
      • "Delete my 3pm meeting"<br>
      • "Join my next meeting"<br>
      • "Open calendar / analytics / settings"<br><br>
      <strong>🧠 Context memory</strong><br>
      • After finding a meeting: "join it", "delete it", "reschedule it to Friday"<br><br>
      <strong>🎤 Voice</strong><br>
      • Tap the mic button and speak naturally`);
    return;
  }

  // ── INTENT: Today's meetings
  if (nlpHas(input, 'today', 'this morning', 'this afternoon') && !nlpHas(input, 'free', 'available', 'slot')) {
    const todayOnce = meetings.filter(m => m.date === today);
    const todayRec  = recurring.filter(r => r.days.includes(todayDay));
    const all = [...todayOnce, ...todayRec.map(r => ({...r, isRec: true}))];
    _aiLastIntent = 'today';
    if (!all.length) {
      aiBotMsg(`No meetings today, ${userName}! 🎉 Enjoy the free time.`,
        [{ label: '➕ Schedule one', fn: () => aiAction('open-new-meeting') }]);
    } else {
      all.sort((a, b) => a.time.localeCompare(b.time));
      const list = all.map(m =>
        `• <strong>${m.subject}</strong> at ${m.time} ${m.isRec ? '🔄' : ''} ` +
        `<button class="ai-inline-btn" onclick="window.open('${m.link || buildLink(m.platform, m.code)}','_blank')">▶ Join</button>`
      ).join('<br>');
      aiBotMsg(`You have <strong>${all.length}</strong> meeting${all.length > 1 ? 's' : ''} today:<br><br>${list}`);
    }
    return;
  }

  // ── INTENT: Past meetings
  if (nlpHas(input, 'past', 'previous', 'last week', 'yesterday', 'last monday', 'last tuesday', 'last wednesday', 'last thursday', 'last friday')) {
    let filterDate = null;
    if (nlpHas(input, 'yesterday')) { const d = new Date(); d.setDate(d.getDate()-1); filterDate = d.toISOString().slice(0,10); }
    else if (nlpHas(input, 'last monday'))    { const d = new Date(); d.setDate(d.getDate() - ((d.getDay()+6)%7+1)); filterDate = d.toISOString().slice(0,10); }
    const past = filterDate
      ? meetings.filter(m => m.date === filterDate)
      : meetings.filter(m => m.date < today).sort((a,b) => b.date.localeCompare(a.date)).slice(0, 8);
    if (!past.length) {
      aiBotMsg(`No past meetings found.`);
    } else {
      aiBotMsg(`<strong>${past.length}</strong> past meeting(s):<br><br>` +
        past.map(m => `• <strong>${m.subject}</strong> — ${m.date} at ${m.time}`).join('<br>'));
    }
    return;
  }

  // ── INTENT: Free slots
  if (nlpHas(input, 'free', 'available', 'slot', 'gap', 'when can i', 'open time')) {
    const targetDate = nlpExtractDate(input) || today;
    const slots = nlpFreeSlots(targetDate);
    if (!slots.length) {
      aiBotMsg(`No free slots found on <strong>${targetDate}</strong> within your working hours.`);
    } else {
      aiBotMsg(`Free slots on <strong>${targetDate}</strong>:<br><br>` +
        slots.map(s => `• ${s}`).join('<br>') +
        `<br><br><em>Based on your working hours and existing meetings.</em>`,
        [{ label: '➕ Schedule in a slot', fn: () => aiAction('prefill-meeting', { date: targetDate }) }]);
    }
    return;
  }

  // ── INTENT: Next meeting
  if (nlpHas(input, 'next meeting', 'upcoming', 'next up', 'soon')) {
    const now    = new Date();
    const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const laterToday = meetings.filter(m => m.date === today && m.time > nowStr).sort((a,b) => a.time.localeCompare(b.time));
    const m = laterToday[0] || meetings.filter(m => m.date > today).sort((a,b) => a.date.localeCompare(b.date))[0];
    if (m) {
      _aiLastResult = m; _aiLastIntent = 'next';
      aiBotMsg(`Next: <strong>${m.subject}</strong> on <strong>${m.date === today ? 'today' : m.date}</strong> at ${m.time} (${m.platform === 'meet' ? 'Google Meet' : m.platform}).`,
        [
          { label: '▶ Join', fn: () => aiAction('join-meeting', { link: m.link || buildLink(m.platform, m.code) }) },
          { label: '✏️ Reschedule', fn: () => { toggleAI(); openEditModal(m.id); } }
        ]);
    } else {
      aiBotMsg(`No upcoming meetings!`, [{ label: '➕ Schedule', fn: () => aiAction('open-new-meeting') }]);
    }
    return;
  }

  // ── INTENT: Filter by platform
  if (nlpHas(input, 'zoom meetings', 'all zoom', 'meet meetings', 'all meet', 'jitsi meetings', 'all jitsi', 'show zoom', 'show meet', 'show jitsi', 'filter by')) {
    const plat = nlpExtractPlatform(input);
    const platName = plat === 'meet' ? 'Google Meet' : plat === 'zoom' ? 'Zoom' : 'Jitsi';
    const filtered = [...meetings, ...recurring].filter(m => m.platform === plat);
    if (!filtered.length) {
      aiBotMsg(`No ${platName} meetings found.`);
    } else {
      aiBotMsg(`<strong>${filtered.length}</strong> ${platName} meeting(s):<br><br>` +
        filtered.map(m =>
          `• <strong>${m.subject}</strong> — ${m.days ? m.days.join(',') : m.date} at ${m.time} ` +
          `<button class="ai-inline-btn" onclick="window.open('${m.link || buildLink(m.platform, m.code)}','_blank')">▶</button>`
        ).join('<br>'));
    }
    return;
  }

  // ── INTENT: Join
  if (nlpHas(input, 'join', 'open meeting', 'start meeting')) {
    const found = nlpFindMeeting(input);
    if (found) {
      _aiLastResult = found;
      aiAction('join-meeting', { link: found.link || buildLink(found.platform, found.code) });
      aiBotMsg(`Opening <strong>${found.subject}</strong>! 🚀`);
    } else {
      const now    = new Date();
      const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      const next   = meetings.filter(m => m.date === today && m.time >= nowStr).sort((a,b) => a.time.localeCompare(b.time))[0]
                  || meetings.filter(m => m.date > today).sort((a,b) => a.date.localeCompare(b.date))[0];
      if (next) {
        _aiLastResult = next;
        aiBotMsg(`Next meeting: <strong>${next.subject}</strong>`,
          [{ label: '▶ Join', fn: () => aiAction('join-meeting', { link: next.link || buildLink(next.platform, next.code) }) }]);
      } else {
        aiBotMsg(`No meetings found to join.`);
      }
    }
    return;
  }

  // ── INTENT: Reschedule
  if (nlpHas(input, 'reschedule', 'move', 'change time', 'change date')) {
    const found   = nlpFindMeeting(input);
    const newDate = nlpExtractDate(input);
    const newTime = nlpExtractTime(input);
    if (found) {
      _aiLastResult = found;
      if (!found.days && (newDate || newTime)) {
        const conflict = nlpCheckConflict(newDate || found.date, newTime || found.time);
        if (conflict && conflict.id !== found.id) {
          aiBotMsg(`⚠️ Conflict: <strong>${conflict.subject}</strong> is already at that time. Reschedule anyway?`, [
            { label: 'Yes, reschedule', fn: () => rescheduleViaAI(found, newDate, newTime) },
            { label: 'Cancel', fn: () => aiBotMsg('Cancelled.') }
          ]);
        } else {
          rescheduleViaAI(found, newDate, newTime);
        }
      } else {
        aiBotMsg(`I'll open the edit form for <strong>${found.subject}</strong>.`,
          [{ label: '✏️ Edit', fn: () => { toggleAI(); openEditModal(found.id); } }]);
      }
    } else {
      aiBotMsg(`Which meeting do you want to reschedule? Say "reschedule [meeting name] to [time/date]".`);
    }
    return;
  }

  // ── INTENT: Schedule / create
  if (nlpHas(input, 'schedule','create','add','new meeting','book','set up','arrange')) {
    const date     = nlpExtractDate(input);
    const time     = nlpExtractTime(input);
    const platform = nlpExtractPlatform(input);
    let subject    = '';
    const calledMatch = input.match(/(?:called|titled|named|for)\s+["'']?([a-z0-9 ]+?)["'']?(?:\s+(?:at|on|with|using)|$)/i);
    if (calledMatch) subject = calledMatch[1].trim();

    // Conflict check
    if (date && time) {
      const conflict = nlpCheckConflict(date, time);
      if (conflict) {
        aiBotMsg(`⚠️ You already have <strong>${conflict.subject}</strong> around ${time} on ${date}. Schedule anyway?`, [
          { label: 'Yes, schedule', fn: () => aiAction('prefill-meeting', { subject, date, time, platform }) },
          { label: 'Find free slot', fn: () => askAI(`when am I free on ${date}`) },
          { label: 'Cancel', fn: () => aiBotMsg('Cancelled.') }
        ]);
        return;
      }
    }

    if (date || time) {
      aiBotMsg(`Got it!${subject ? ' For "' + subject + '".' : ''} Opening form${date ? ' for ' + date : ''}${time ? ' at ' + time : ''} 📝`,
        [{ label: '➕ Open form', fn: () => aiAction('prefill-meeting', { subject, date, time, platform }) }]);
    } else {
      aiBotMsg(`Opening the meeting form.`, [{ label: '➕ New meeting', fn: () => aiAction('open-new-meeting') }]);
    }
    return;
  }

  // ── INTENT: Delete
  if (nlpHas(input, 'delete','remove','cancel','clear')) {
    const found = nlpFindMeeting(input);
    if (found) {
      _aiLastResult = found;
      aiBotMsg(`Delete <strong>${found.subject}</strong>${found.date ? ' on ' + found.date : ''}?`, [
        { label: '🗑 Yes, delete', fn: () => {
            found.days ? deleteRecurring(found.id) : deleteMeeting(found.id);
            aiBotMsg(`✅ <strong>${found.subject}</strong> deleted.`);
            _aiLastResult = null;
        }},
        { label: 'Cancel', fn: () => aiBotMsg('Keeping it!') }
      ]);
    } else {
      const upcoming = meetings.filter(m => m.date >= today).sort((a,b) => a.date.localeCompare(b.date)).slice(0, 5);
      aiBotMsg(`Which meeting? Say "delete [name]".<br><br>` +
        upcoming.map(m => `• <strong>${m.subject}</strong> — ${m.date}`).join('<br>'));
    }
    return;
  }

  // ── INTENT: Find / search
  if (nlpHas(input, 'find','search','look for','where is','show me')) {
    const found = nlpFindMeeting(input);
    if (found) {
      _aiLastResult = found; _aiLastIntent = 'found';
      const isRec = !!found.days;
      aiBotMsg(
        `Found: <strong>${found.subject}</strong><br>` +
        `${isRec ? '🔄 ' + found.days.join(', ') : '📅 ' + found.date} at ${found.time}<br>` +
        `Platform: ${found.platform === 'meet' ? 'Google Meet' : found.platform}`,
        [
          { label: '▶ Join', fn: () => aiAction('join-meeting', { link: found.link || buildLink(found.platform, found.code) }) },
          { label: '✏️ Edit', fn: () => { toggleAI(); if (isRec) openRecurringEdit(found.id); else openEditModal(found.id); } },
          { label: '🗑 Delete', fn: () => askAI(`delete ${found.subject}`) }
        ]
      );
    } else {
      aiBotMsg(`Couldn't find that meeting.`, [{ label: '🔍 All Meetings', fn: () => aiAction('navigate', { page: 'meetings' }) }]);
    }
    return;
  }

  // ── INTENT: Summary
  if (nlpHas(input, 'summary','overview','stats','how many','count','total')) {
    const todayCount = meetings.filter(m => m.date === today).length + recurring.filter(r => r.days.includes(todayDay)).length;
    const future     = meetings.filter(m => m.date > today);
    const past       = meetings.filter(m => m.date < today);
    const platforms  = {};
    [...meetings, ...recurring].forEach(m => { platforms[m.platform] = (platforms[m.platform] || 0) + 1; });
    const topPlat = Object.entries(platforms).sort((a,b) => b[1]-a[1])[0];
    aiBotMsg(
      `Meeting overview for <strong>${userName}</strong>:<br><br>` +
      `📋 <strong>${meetings.length}</strong> one-time &nbsp;🔄 <strong>${recurring.length}</strong> recurring<br>` +
      `📅 <strong>${todayCount}</strong> today &nbsp;⏭ <strong>${future.length}</strong> upcoming<br>` +
      `📂 <strong>${past.length}</strong> past meetings<br>` +
      `${topPlat ? `🏆 Top platform: <strong>${topPlat[0] === 'meet' ? 'Google Meet' : topPlat[0]}</strong> (${topPlat[1]})` : ''}`,
      [{ label: '📊 Full analytics', fn: () => aiAction('navigate', { page: 'analytics' }) }]
    );
    return;
  }

  // ── INTENT: This week
  if (nlpHas(input, 'this week', 'week')) {
    const now   = new Date();
    const start = new Date(now); start.setDate(now.getDate() - now.getDay());
    const end   = new Date(start); end.setDate(start.getDate() + 6);
    const thisWeek = meetings.filter(m => m.date >= start.toISOString().slice(0,10) && m.date <= end.toISOString().slice(0,10));
    aiBotMsg(thisWeek.length
      ? `This week: <strong>${thisWeek.length}</strong> meeting(s):<br><br>` +
        thisWeek.sort((a,b) => a.date.localeCompare(b.date)).map(m => `• <strong>${m.subject}</strong> — ${m.date} at ${m.time}`).join('<br>')
      : 'No meetings this week.',
      [{ label: '📆 Calendar', fn: () => aiAction('navigate', { page: 'calendarPage' }) }]
    );
    return;
  }

  // ── INTENT: Recurring
  if (nlpHas(input, 'recurring','repeat','every week','weekly','daily')) {
    if (!recurring.length) {
      aiBotMsg(`No recurring meetings yet.`, [{ label: '➕ Create', fn: () => aiAction('navigate', { page: 'dashboard' }) }]);
    } else {
      aiBotMsg(`<strong>${recurring.length}</strong> recurring meeting(s):<br><br>` +
        recurring.map(r => `• <strong>${r.subject}</strong> — ${r.days.join(', ')} at ${r.time}`).join('<br>'));
    }
    return;
  }

  // ── INTENT: Navigation
  if (nlpHas(input, 'go to','open','navigate','show me','take me')) {
    if (nlpHas(input, 'dashboard','home'))              { aiBotMsg('Dashboard! 🏠');     setTimeout(() => aiAction('navigate', { page: 'dashboard' }), 400);     return; }
    if (nlpHas(input, 'calendar'))                        { aiBotMsg('Calendar! 📆');       setTimeout(() => aiAction('navigate', { page: 'calendarPage' }), 400);  return; }
    if (nlpHas(input, 'analytics','stats','charts'))  { aiBotMsg('Analytics! 📊');      setTimeout(() => aiAction('navigate', { page: 'analytics' }), 400);     return; }
    if (nlpHas(input, 'meetings','all meeting'))        { aiBotMsg('All Meetings! 📋');    setTimeout(() => aiAction('navigate', { page: 'meetings' }), 400);       return; }
    if (nlpHas(input, 'settings','profile','account')) {
      const tab = nlpHas(input,'notification')?'notifications':nlpHas(input,'appear','theme')?'appearance':nlpHas(input,'security')?'security':'profile';
      aiBotMsg('Settings! ⚙️'); setTimeout(() => aiAction('open-settings', { tab }), 400); return;
    }
  }

  // ── INTENT: Time / date
  if (nlpHas(input, 'what time', 'current time', 'date today')) {
    const now = new Date();
    aiBotMsg(`It's <strong>${now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</strong> — ${now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}.`);
    return;
  }

  // ── INTENT: Busiest day
  if (nlpHas(input, 'busiest','most meetings','heavy','packed')) {
    const days = {Mon:0,Tue:0,Wed:0,Thu:0,Fri:0,Sat:0,Sun:0};
    meetings.forEach(m => { const d = new Date(m.date+'T12:00:00').toLocaleString('default',{weekday:'short'}); if(days[d]!==undefined) days[d]++; });
    recurring.forEach(r => r.days.forEach(d => { if(days[d]!==undefined) days[d]++; }));
    const busiest = Object.entries(days).sort((a,b) => b[1]-a[1])[0];
    aiBotMsg(busiest[1] > 0
      ? `Busiest day: <strong>${busiest[0]}</strong> with ${busiest[1]} meeting(s).`
      : `Not enough data to determine busiest day.`);
    return;
  }

  // ── INTENT: Availability
  if (nlpHas(input, 'availability','working hours','my hours')) {
    const avail = s.availability;
    aiBotMsg(
      `Working hours: <strong>${avail?.start||'09:00'}</strong> to <strong>${avail?.end||'17:00'}</strong><br>` +
      `Buffer: <strong>${avail?.buffer||0} min</strong> between meetings<br>` +
      `Max per day: <strong>${avail?.maxPerDay||10}</strong>`,
      [{ label: '⚙️ Edit availability', fn: () => aiAction('open-settings', { tab: 'availability' }) }]
    );
    return;
  }

  // ── Fallback: try to match a meeting name
  const mentioned = nlpFindMeeting(input);
  if (mentioned) {
    _aiLastResult = mentioned;
    const isRec = !!mentioned.days;
    aiBotMsg(
      `Found <strong>${mentioned.subject}</strong>:<br>` +
      `${isRec ? '🔄 '+mentioned.days.join(', ') : '📅 '+mentioned.date} at ${mentioned.time}`,
      [
        { label: '▶ Join', fn: () => aiAction('join-meeting', { link: mentioned.link || buildLink(mentioned.platform, mentioned.code) }) },
        { label: '✏️ Edit', fn: () => { toggleAI(); isRec ? openRecurringEdit(mentioned.id) : openEditModal(mentioned.id); } }
      ]
    );
    return;
  }

  aiBotMsg(`Not sure what you mean. Try: <em>"meetings today"</em>, <em>"when am I free"</em>, <em>"reschedule my standup to 2pm"</em>, or <em>"open the calendar"</em>.`);
}

// ── Reschedule a meeting via AI (direct update to Supabase)
async function rescheduleViaAI(m, newDate, newTime) {
  const updates = {
    date: newDate || m.date,
    time: newTime || m.time,
  };
  const { data, error } = await sb.from('meetings').update(updates).eq('id', m.id).select().single();
  if (error) {
    aiBotMsg(`❌ Couldn't reschedule: ${error.message}`);
  } else {
    _meetings = _meetings.map(x => x.id === m.id ? data : x);
    refreshAll();
    aiBotMsg(`✅ <strong>${m.subject}</strong> rescheduled to ${updates.date} at ${updates.time}.`);
    _aiLastResult = data;
  }
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
window.aiAction            = aiAction;
window.aiUpdateSuggestions = aiUpdateSuggestions;
window.aiClearChat         = aiClearChat;
window.aiVoiceInput        = aiVoiceInput;
window.aiCopyMsg           = aiCopyMsg;
window.toggleBotEnabled       = toggleBotEnabled;

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

/* ============================================================
   AI WINDOW — RESIZE HANDLE
   Drag top-left corner to resize the chat window
============================================================ */
(function() {
  let resizing = false, startX, startY, startW, startH, startRight, startBottom;

  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('aiResizeHandle');
    const win    = document.getElementById('aiWindow');
    if (!handle || !win) return;

    handle.addEventListener('mousedown', e => {
      resizing = true;
      startX      = e.clientX;
      startY      = e.clientY;
      startW      = win.offsetWidth;
      startH      = win.offsetHeight;
      e.preventDefault();
    });

    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const dx = startX - e.clientX; // dragging left = wider
      const dy = startY - e.clientY; // dragging up = taller
      const newW = Math.max(280, startW + dx);
      const newH = Math.max(320, startH + dy);
      win.style.width  = newW + 'px';
      win.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => { resizing = false; });

    // Touch support
    handle.addEventListener('touchstart', e => {
      resizing = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startW = win.offsetWidth;
      startH = win.offsetHeight;
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (!resizing) return;
      const dx = startX - e.touches[0].clientX;
      const dy = startY - e.touches[0].clientY;
      win.style.width  = Math.max(280, startW + dx) + 'px';
      win.style.height = Math.max(320, startH + dy) + 'px';
    }, { passive: true });

    document.addEventListener('touchend', () => { resizing = false; });
  });
})();
