import { sb, getRole, keyMissing, fmtTime, fmtDate } from './supabase.js';
import { SETTINGS } from './config.js';
import { loadModels, startCamera, detectFaces, buildMatcher, eyeOpenness, BlinkDetector } from './face.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), overlay = $('overlay'), cam = $('cam'), statusEl = $('status');

let matcher = null, employeesById = new Map();
let busy = false, showingResult = false;
let candidate = null, candidateFrames = 0, unknownFrames = 0;
const blink = new BlinkDetector();
const recentlyPunched = new Map(); // employeeId -> timestamp

// ---------- clock ----------
function tick() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString('en-PH', { timeZone: SETTINGS.timezone, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  $('date').textContent = fmtDate(now);
}
setInterval(tick, 1000); tick();

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

function resetCandidate() { candidate = null; candidateFrames = 0; blink.reset(); }

async function loop() {
  if (!busy && !showingResult) {
    busy = true;
    try { await processFrame(); } catch (e) { console.error(e); }
    busy = false;
  }
  setTimeout(loop, 120);
}

async function processFrame() {
  const dets = await detectFaces(video);
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  if (dets.length === 0) { resetCandidate(); unknownFrames = 0; return setStatus('Look at the camera'); }
  if (dets.length > 1) { resetCandidate(); return setStatus('One person at a time, please', 'wait'); }

  const d = dets[0];
  const box = d.detection.box;
  ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.width, box.height);

  if (box.width < overlay.width * 0.22) { resetCandidate(); return setStatus('Please come closer', 'wait'); }
  if (!matcher) return setStatus('No employees enrolled yet', 'bad');

  const best = matcher.findBestMatch(d.descriptor);
  if (best.label === 'unknown') {
    resetCandidate();
    unknownFrames++;
    return setStatus(unknownFrames > 10 ? 'Face not recognized — please see the admin' : 'Scanning…', unknownFrames > 10 ? 'bad' : 'wait');
  }
  unknownFrames = 0;

  if (candidate !== best.label) { resetCandidate(); candidate = best.label; }
  candidateFrames++;
  const blinked = blink.update(eyeOpenness(d.landmarks));
  const emp = employeesById.get(best.label);

  const last = recentlyPunched.get(best.label);
  if (last && Date.now() - last < SETTINGS.kioskRepeatSeconds * 1000) {
    return setStatus(`${emp.full_name} — already recorded`, 'ok');
  }

  if (candidateFrames < 3) return setStatus('Scanning…', 'wait');
  if (SETTINGS.requireBlink && !blinked) return setStatus(`Hi ${emp.full_name.split(' ')[0]}! Please blink 👁️`, 'wait');

  await punch(emp, best.distance);
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
    showResult(isIn ? 'in' : 'out', isIn ? 'TIME IN' : 'TIME OUT', data.full_name, fmtTime(data.punched_at), isIn ? 'Have a great day!' : 'Ingat! See you tomorrow.');
  }
  recentlyPunched.set(emp.id, Date.now());
}

function showResult(cls, tag, name, time, msg) {
  $('rTag').className = 'tag ' + cls; $('rTag').textContent = tag;
  $('rName').textContent = name; $('rTime').textContent = time; $('rMsg').textContent = msg;
  $('result').classList.remove('hidden');
  setTimeout(() => { $('result').classList.add('hidden'); showingResult = false; setStatus('Look at the camera'); }, 3500);
}

boot();
