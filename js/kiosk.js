import { sb, getRole, keyMissing, fmtTime, fmtDate } from './supabase.js';
import { SETTINGS } from './config.js';
import { loadModels, startCamera, detectFaces, buildMatcher, LivenessDetector } from './face.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), cam = $('cam'), statusEl = $('status');

let matcher = null, employeesById = new Map();
let busy = false, showingResult = false;
let candidate = null, candidateFrames = 0, unknownFrames = 0;
const live = new LivenessDetector();
let frameNo = 0, lastMatch = null;
const recentlyPunched = new Map(); // employeeId -> timestamp

// ---------- clock + greeting ----------
function tick() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-PH', { timeZone: SETTINGS.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  const hm = parts.filter((p) => ['hour', 'literal', 'minute'].includes(p.type)).map((p) => p.value).join('').trim();
  const ap = parts.find((p) => p.type === 'dayPeriod')?.value.toUpperCase() || '';
  $('clock').innerHTML = `${hm} <span>${ap}</span>`;
  $('date').textContent = fmtDate(now);
}
setInterval(tick, 1000); tick();

// ---------- employee photos (for the result card and "Just now") ----------
const photoCache = new Map();
async function getPhoto(employeeNo) {
  if (!employeeNo) return null;
  if (photoCache.has(employeeNo)) return photoCache.get(employeeNo);
  const { data } = await sb.from('employees').select('photo').eq('employee_no', employeeNo).maybeSingle();
  photoCache.set(employeeNo, data?.photo || null);
  return data?.photo || null;
}

// ---------- "Present today" counter (counts only) ----------
async function refreshStats() {
  const { data, error } = await sb.rpc('kiosk_today_stats');
  if (error || !data) return;
  $('presentN').textContent = data.present; $('totalN').textContent = data.total;
  $('presentBar').style.width = data.total ? Math.round((data.present / data.total) * 100) + '%' : '0';
}

// ---------- beep ----------
let audioCtx = null;
function beep(ok = true) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const tones = ok ? [[880, 0], [1320, 0.12]] : [[220, 0], [180, 0.18]];
    tones.forEach(([f, t]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = ok ? 'sine' : 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.16);
      o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.18);
    });
  } catch (e) { /* sound not available */ }
}
// browsers only allow sound after the page is touched once
window.addEventListener('pointerdown', () => { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); }, { once: true });

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  cam.className = 'cam ' + cls;
}

// ---------- auth ----------
async function boot() {
  if (keyMissing) { $('keyBanner').classList.remove('hidden'); return; }
  let role = null;
  try { role = await getRole(); } catch (e) { console.error(e); }
  if (role === 'kiosk' || role === 'admin') return startKiosk();
  if (role === 'none') await sb.auth.signOut();
  $('loginView').classList.remove('hidden');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (error) return ($('loginError').textContent = error.message);
  const role = await getRole();
  if (role !== 'kiosk' && role !== 'admin') {
    await sb.auth.signOut();
    return ($('loginError').textContent = 'This account is not allowed to run the kiosk.');
  }
  $('loginView').classList.add('hidden');
  startKiosk();
});

$('logoutBtn').addEventListener('click', async () => {
  if (!confirm('Sign out this kiosk?')) return;
  await sb.auth.signOut();
  location.reload();
});

// ---------- kiosk ----------
async function loadEmployees() {
  const { data, error } = await sb.from('employees').select('id, employee_no, full_name, face_descriptors').eq('active', true);
  if (error) throw error;
  employeesById = new Map(data.map((e) => [e.id, e]));
  matcher = buildMatcher(data, SETTINGS.matchThreshold);
  const enrolled = data.filter((e) => e.face_descriptors?.length).length;
  $('info').textContent = `${enrolled} of ${data.length} employees enrolled`;
}

async function startKiosk() {
  $('kioskView').classList.remove('hidden');
  refreshStats(); setInterval(refreshStats, 60000);
  if (SETTINGS.kioskMode === 'qr') {
    document.body.classList.add('qr-mode');
    const { startQrKiosk } = await import('./kiosk-qr.js');
    $('info').textContent = 'ID card scanner';
    return startQrKiosk({ video, setStatus, isBusy: () => showingResult, showResult: (r, ...rest) => {
      if (typeof r === 'string') return showResult(r, ...rest);
      if (r.status === 'unknown') return showResult('dup', 'NOT VALID', 'ID not recognized', '—', 'This card is inactive or was replaced. Please see the admin.');
      if (r.status === 'duplicate') return showResult('dup', 'ALREADY RECORDED', r.full_name, fmtTime(r.punched_at), `Time ${r.punch_type} was just recorded.`);
      const isIn = r.punch_type === 'in';
      showResult(isIn ? 'in' : 'out', isIn ? 'TIME IN' : 'TIME OUT', r.full_name, fmtTime(r.punched_at), isIn ? 'Have a great day!' : 'Ingat! See you tomorrow.', r.employee_no);
      refreshStats();
    } });
  }
  $('greet').textContent = 'Look at the camera';
  try {
    setStatus('Loading face models…');
    await Promise.all([loadModels(), loadEmployees()]);
    setStatus('Starting camera…');
    await startCamera(video);
  } catch (e) {
    console.error(e);
    return setStatus('⚠ ' + (e.message || 'Could not start. Check camera permission and internet.'), 'bad');
  }
  setInterval(() => loadEmployees().catch(console.error), 10 * 60 * 1000); // refresh every 10 min
  overlay.width = video.videoWidth; overlay.height = video.videoHeight;
  setStatus('Look at the camera');
  loop();
}

function resetCandidate() { candidate = null; candidateFrames = 0; lastMatch = null; live.reset(); }

async function loop() {
  if (!busy && !showingResult) {
    busy = true;
    try { await processFrame(); } catch (e) { console.error(e); }
    busy = false;
  }
  requestAnimationFrame(loop);
}

async function processFrame() {
  frameNo++;
  // Recognize (slow) only when needed; track eyes/head (fast) on every frame.
  const needId = !candidate || frameNo % 8 === 0;
  const dets = await detectFaces(video, { descriptors: needId, inputSize: 320 });
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (dets.length === 0) { resetCandidate(); unknownFrames = 0; return setStatus('Look at the camera'); }
  if (dets.length > 1) { resetCandidate(); return setStatus('One person at a time, please', 'wait'); }

  const d = dets[0];
  const box = d.detection.box;
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.width, box.height);

  if (box.width < overlay.width * 0.22) { resetCandidate(); return setStatus('Please come closer', 'wait'); }
  if (!matcher) return setStatus('No employees enrolled yet', 'bad');

  if (needId) {
    const best = matcher.findBestMatch(d.descriptor);
    if (best.label === 'unknown') {
      resetCandidate();
      unknownFrames++;
      return setStatus(unknownFrames > 6 ? 'Face not recognized — please see the admin' : 'Scanning…', unknownFrames > 6 ? 'bad' : 'wait');
    }
    unknownFrames = 0;
    if (candidate !== best.label) { resetCandidate(); candidate = best.label; }
    candidateFrames++;
    lastMatch = best;
  }

  const alive = live.update(d.landmarks, box);
  const emp = employeesById.get(candidate);

  const last = recentlyPunched.get(candidate);
  if (last && Date.now() - last < SETTINGS.kioskRepeatSeconds * 1000) {
    return setStatus(`${emp.full_name} — already recorded`, 'ok');
  }

  if (SETTINGS.requireBlink && !alive) return setStatus(`Hi ${emp.full_name.split(' ')[0]}! Blink or turn your head slightly 👁️`, 'wait');
  if (candidateFrames < 2) return setStatus('Scanning…', 'wait'); // confirm identity twice

  await punch(emp, lastMatch.distance);
}

async function punch(emp, distance) {
  showingResult = true;
  setStatus('Recording…', 'ok');
  const { data, error } = await sb.rpc('record_punch', { p_employee_id: emp.id, p_score: distance });
  resetCandidate();
  if (error) {
    console.error(error);
    showResult('dup', 'ERROR', emp.full_name, '—', error.message);
  } else if (data.status === 'duplicate') {
    showResult('dup', 'ALREADY RECORDED', data.full_name, fmtTime(data.punched_at), `Time ${data.punch_type} was just recorded.`);
  } else {
    const isIn = data.punch_type === 'in';
    showResult(isIn ? 'in' : 'out', isIn ? 'TIME IN' : 'TIME OUT', data.full_name, fmtTime(data.punched_at), isIn ? 'Have a great day!' : 'Ingat! See you tomorrow.', data.employee_no);
    refreshStats();
  }
  recentlyPunched.set(emp.id, Date.now());
}

let resultTimer = null;
async function showResult(cls, tag, name, time, msg, employeeNo) {
  showingResult = true;
  $('rTag').className = 'tag ' + cls; $('rTag').textContent = tag;
  $('rName').textContent = name; $('rTime').textContent = time; $('rMsg').textContent = msg;
  beep(cls === 'in' || cls === 'out');
  $('rPhoto').classList.add('hidden'); $('rPhotoBox').classList.toggle('hidden', !employeeNo);
  $('result').classList.remove('hidden');
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => { $('result').classList.add('hidden'); showingResult = false; setStatus(SETTINGS.kioskMode === 'qr' ? 'Hold the QR code inside the gold corners' : 'Look at the camera'); }, 3500);
  const photo = await getPhoto(employeeNo);
  if (photo && showingResult) { $('rPhoto').src = photo; $('rPhoto').classList.remove('hidden'); }
}

boot();
