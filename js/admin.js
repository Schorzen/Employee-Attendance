import { sb, getRole, keyMissing, fmtTime, fmtDate, todayISO, esc, fetchAll } from './supabase.js';
import { SETTINGS } from './config.js';

const $ = (id) => document.getElementById(id);
let employees = [];
let currentExport = { name: 'attendance.csv', rows: [] };

document.title = `${SETTINGS.companyName} — Admin`;
$('appTitle').textContent = SETTINGS.companyName;

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

// ---------------- auth ----------------
async function boot() {
  if (keyMissing) return $('keyBanner').classList.remove('hidden');
  let role = null;
  try { role = await getRole(); } catch (e) { console.error(e); }
  if (role === 'admin') return startApp();
  if (role === 'none') await sb.auth.signOut();
  $('loginView').classList.remove('hidden');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (error) return ($('loginError').textContent = error.message);
  if ((await getRole()) !== 'admin') {
    await sb.auth.signOut();
    return ($('loginError').textContent = 'This account is not an admin.');
  }
  $('loginView').classList.add('hidden');
  startApp();
});

$('logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function startApp() {
  $('app').classList.remove('hidden');
  sb.auth.getUser().then(({ data }) => { if (data?.user?.email) $('userEmail').textContent = data.user.email; });
  $('fFrom').value = $('fTo').value = todayISO();
  await loadEmployees();
  renderToday();
}

// ---------------- tabs ----------------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  ['today', 'records', 'employees'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  if (b.dataset.tab === 'today') renderToday();
  if (b.dataset.tab === 'records') loadRecords();
  if (b.dataset.tab === 'employees') loadPhotos().then(renderEmployees);
}));

document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------------- data ----------------
async function loadEmployees() {
  employees = await fetchAll(() => sb.from('employees')
    .select('id, employee_no, full_name, department, position, active, consent_at, face_descriptors, has_photo')
    .order('full_name'));
  const opts = employees.map((e) => `<option value="${e.id}">${esc(e.full_name)} (${esc(e.employee_no)})</option>`).join('');
  $('fEmp').innerHTML = '<option value="">All employees</option>' + opts;
  $('mEmp').innerHTML = employees.filter((e) => e.active).map((e) => `<option value="${e.id}">${esc(e.full_name)} (${esc(e.employee_no)})</option>`).join('');
}
const empById = (id) => employees.find((e) => e.id === id) || {};

async function fetchPunches(from, to, empId) {
  return fetchAll(() => {
    let q = sb.from('attendance').select('*').gte('work_date', from).lte('work_date', to)
      .order('punched_at', { ascending: true });
    if (empId) q = q.eq('employee_id', empId);
    return q;
  });
}

// Group punches into one row per employee per day
function summarize(punches) {
  const groups = new Map();
  for (const p of punches) {
    const k = p.employee_id + '|' + p.work_date;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const out = [];
  for (const list of groups.values()) {
    let ms = 0, openIn = null;
    for (const p of list) {
      if (p.punch_type === 'in') openIn ??= p;
      else if (openIn) { ms += new Date(p.punched_at) - new Date(openIn.punched_at); openIn = null; }
    }
    const ins = list.filter((p) => p.punch_type === 'in');
    const outs = list.filter((p) => p.punch_type === 'out');
    out.push({
      employee_id: list[0].employee_id, work_date: list[0].work_date,
      first_in: ins[0]?.punched_at || null, last_out: outs.at(-1)?.punched_at || null,
      hours: ms / 36e5, punches: list.length,
      open: list.at(-1).punch_type === 'in', manual: list.some((p) => p.method === 'manual'),
    });
  }
  return out;
}

const hrs = (h) => (h ? h.toFixed(2) : '—');

// ---------------- photos (loaded once, kept in memory) ----------------
const photos = new Map();
let photosLoaded = null;
function loadPhotos() {
  photosLoaded ??= fetchAll(() => sb.from('employees').select('id, photo').eq('has_photo', true))
    .then((rows) => rows.forEach((r) => photos.set(r.id, r.photo)))
    .catch((e) => { console.error(e); photosLoaded = null; });
  return photosLoaded;
}
const initials = (n) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avatar = (e, cls = 'thumb') => photos.get(e.id)
  ? `<img class="${cls}" src="${photos.get(e.id)}" alt="">`
  : `<div class="${cls === 'thumb' ? 'thumb-ini' : 'ini'}">${esc(initials(e.full_name))}</div>`;

// ---------------- today ----------------
let todayFilter = 'all', todayTimer = null, todayCache = null;
$('refreshToday').addEventListener('click', () => renderToday());
$('todayFilters').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-f]'); if (!btn) return;
  todayFilter = btn.dataset.f;
  document.querySelectorAll('#todayFilters .kpi').forEach((k) => k.classList.toggle('active', k === btn));
  renderToday(false);
});
$('todaySearch').addEventListener('input', () => renderToday(false));
$('addEmpTop').addEventListener('click', () => openEmpForm(null));

async function renderToday(refetch = true) {
  const today = todayISO();
  if (refetch || !todayCache) {
    const [punches] = await Promise.all([fetchPunches(today, today), loadPhotos()]);
    todayCache = punches;
  }
  const sum = new Map(summarize(todayCache).map((x) => [x.employee_id, x]));
  const active = employees.filter((e) => e.active);
  const statusOf = (e) => { const x = sum.get(e.id); return !x ? 'none' : x.open ? 'in' : 'out'; };
  const n = { all: active.length, in: 0, out: 0, none: 0 };
  active.forEach((e) => n[statusOf(e)]++);

  $('todayTitle').textContent = fmtDate(new Date());
  $('kAll').textContent = n.all; $('kPresent').textContent = n.in + n.out; $('kIn').textContent = n.in; $('kNone').textContent = n.none;

  const q = $('todaySearch').value.trim().toLowerCase();
  const list = active.filter((e) => {
    const st = statusOf(e);
    const okF = todayFilter === 'all' || (todayFilter === 'present' ? st !== 'none' : st === todayFilter);
    const okQ = !q || [e.full_name, e.employee_no, e.position, e.department].join(' ').toLowerCase().includes(q);
    return okF && okQ;
  });
  const pill = { in: '<span class="pill in">IN</span>', out: '<span class="pill out">OUT</span>', none: '<span class="pill none">NOT YET IN</span>' };
  $('todayTable').innerHTML = `<thead><tr><th>Employee</th><th>Position</th><th>Time in</th><th>Time out</th><th>Hours</th><th>Status</th></tr></thead><tbody>${
    list.map((e) => { const x = sum.get(e.id); return `<tr>
      <td><div class="emp-cell">${avatar(e)}<div><b>${esc(e.full_name)}</b><div class="sub">${esc(e.employee_no)}</div></div></div></td>
      <td>${esc(e.position || '—')}</td>
      <td><b>${x?.first_in ? fmtTime(x.first_in) : '—'}</b></td>
      <td><b>${x?.last_out ? fmtTime(x.last_out) : '—'}</b></td>
      <td>${hrs(x?.hours)}</td><td>${pill[statusOf(e)]}</td></tr>`; }).join('')
    || `<tr><td colspan="6" class="empty">${active.length ? 'No employees match.' : 'No employees yet — click “+ Add employee”.'}</td></tr>`}</tbody>`;

  clearTimeout(todayTimer);
  if (!$('tab-today').classList.contains('hidden')) todayTimer = setTimeout(() => renderToday(), 30000);
}

// ---------------- records ----------------
$('loadRecords').addEventListener('click', loadRecords);
$('fView').addEventListener('change', loadRecords);

async function loadRecords() {
  const from = $('fFrom').value, to = $('fTo').value;
  if (!from || !to) return;
  $('recordsTable').innerHTML = '<tbody><tr><td class="empty">Loading…</td></tr></tbody>';
  const punches = await fetchPunches(from, to, $('fEmp').value);

  if ($('fView').value === 'summary') {
    const rows = summarize(punches).sort((a, b) => a.work_date.localeCompare(b.work_date) || (empById(a.employee_id).full_name || '').localeCompare(empById(b.employee_id).full_name || ''));
    const isPastOpen = (r) => r.open && r.work_date < todayISO();
    $('recordsTable').innerHTML = `<thead><tr><th>Date</th><th>ID</th><th>Name</th><th>Time in</th><th>Time out</th><th>Hours</th><th>Punches</th><th>Notes</th></tr></thead><tbody>${
      rows.map((r) => { const e = empById(r.employee_id); return `<tr><td>${esc(r.work_date)}</td><td>${esc(e.employee_no)}</td><td>${esc(e.full_name)}</td>
        <td>${r.first_in ? fmtTime(r.first_in) : '—'}</td><td>${r.last_out ? fmtTime(r.last_out) : '—'}</td><td>${hrs(r.hours)}</td><td>${r.punches}</td>
        <td>${isPastOpen(r) ? '<span class="pill warn">No time out</span> ' : ''}${r.manual ? '<span class="pill none">Manual</span>' : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="8" class="empty">No records for this period.</td></tr>'}</tbody>`;
    currentExport = {
      name: `attendance-summary_${from}_to_${to}.csv`,
      rows: [['Date', 'Employee ID', 'Name', 'Department', 'Time in', 'Time out', 'Hours', 'Punches', 'Missing time out'],
        ...rows.map((r) => { const e = empById(r.employee_id); return [r.work_date, e.employee_no, e.full_name, e.department,
          r.first_in ? fmtTime(r.first_in) : '', r.last_out ? fmtTime(r.last_out) : '', r.hours.toFixed(2), r.punches, isPastOpen(r) ? 'YES' : '']; })],
    };
  } else {
    const rows = [...punches].reverse();
    $('recordsTable').innerHTML = `<thead><tr><th>Date</th><th>Time</th><th>ID</th><th>Name</th><th>Type</th><th>Method</th><th>Match</th><th>Note</th><th></th></tr></thead><tbody>${
      rows.map((p) => { const e = empById(p.employee_id); return `<tr><td>${esc(p.work_date)}</td><td>${fmtTime(p.punched_at)}</td><td>${esc(e.employee_no)}</td><td>${esc(e.full_name)}</td>
        <td><span class="pill ${p.punch_type}">${p.punch_type.toUpperCase()}</span></td><td>${p.method}</td>
        <td>${p.match_score != null ? (100 - p.match_score * 100).toFixed(0) + '%' : '—'}</td><td>${esc(p.note)}</td>
        <td><button class="btn sm danger" data-del="${p.id}">Delete</button></td></tr>`; }).join('')
      || '<tr><td colspan="9" class="empty">No records for this period.</td></tr>'}</tbody>`;
    currentExport = {
      name: `attendance-punches_${from}_to_${to}.csv`,
      rows: [['Date', 'Time', 'Employee ID', 'Name', 'Type', 'Method', 'Note'],
        ...rows.map((p) => { const e = empById(p.employee_id); return [p.work_date, fmtTime(p.punched_at), e.employee_no, e.full_name, p.punch_type.toUpperCase(), p.method, p.note || '']; })],
    };
  }
}

$('recordsTable').addEventListener('click', async (e) => {
  const id = e.target.dataset.del;
  if (!id || !confirm('Delete this punch? This cannot be undone.')) return;
  const { error } = await sb.from('attendance').delete().eq('id', id);
  if (error) return alert(error.message);
  toast('Punch deleted'); loadRecords();
});

$('exportCsv').addEventListener('click', () => {
  if (currentExport.rows.length <= 1) return toast('Nothing to export — click Show first');
  const csv = currentExport.rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = currentExport.name; a.click();
});

// manual entry
$('addManual').addEventListener('click', () => {
  const now = new Date().toLocaleString('sv-SE', { timeZone: SETTINGS.timezone }).slice(0, 16).replace(' ', 'T');
  $('mWhen').value = now; $('mNote').value = ''; $('mError').textContent = '';
  $('manualDialog').showModal();
});
$('manualForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const when = $('mWhen').value; // local Manila time (UTC+8, no daylight saving)
  const { error } = await sb.from('attendance').insert({
    employee_id: $('mEmp').value, punch_type: $('mType').value, method: 'manual',
    punched_at: `${when}:00+08:00`, work_date: when.slice(0, 10), note: $('mNote').value.trim(),
  });
  if (error) return ($('mError').textContent = error.message);
  $('manualDialog').close(); toast('Manual entry saved'); loadRecords();
});

// ---------------- employees ----------------
$('empSearch').addEventListener('input', renderEmployees);

const faceMode = SETTINGS.kioskMode === 'face';

function renderEmployees() {
  const q = $('empSearch').value.toLowerCase();
  const list = employees.filter((e) => !q || [e.full_name, e.employee_no, e.department, e.position].join(' ').toLowerCase().includes(q));
  $('empTable').innerHTML = `<thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Position</th>${faceMode ? '<th>Face</th>' : ''}<th>Status</th><th></th></tr></thead><tbody>${
    list.map((e) => { const n = e.face_descriptors?.length || 0; return `<tr><td><div class="emp-cell">${avatar(e)}<b>${esc(e.full_name)}</b>${e.has_photo ? '' : ' <span class="pill warn">No photo</span>'}</div></td><td>${esc(e.employee_no)}</td><td>${esc(e.department)}</td><td>${esc(e.position)}</td>
      ${faceMode ? `<td>${n ? '<span class="pill in">Enrolled</span>' : '<span class="pill warn">Not enrolled</span>'}</td>` : ''}
      <td>${e.active ? 'Active' : '<span class="pill none">Inactive</span>'}</td>
      <td class="actions"><button class="btn sm" data-edit="${e.id}">Edit</button>
        <a class="btn sm" href="idcards.html?ids=${e.id}" target="_blank">ID card</a>
        <button class="btn sm" data-reissue="${e.id}">Replace ID</button>
        ${faceMode ? `<button class="btn sm" data-enroll="${e.id}">${n ? 'Re-enroll' : 'Enroll face'}</button>` : ''}
        ${n ? `<button class="btn sm danger" data-clear="${e.id}">Remove face</button>` : ''}
        <button class="btn sm danger" data-delete="${e.id}">Delete</button></td></tr>`; }).join('')
    || '<tr><td colspan="7" class="empty">No employees yet.</td></tr>'}</tbody>`;
}

$('empTable').addEventListener('click', async (ev) => {
  const t = ev.target.dataset;
  if (t.edit) openEmpForm(empById(t.edit));
  if (t.enroll) openEnroll(empById(t.enroll));
  if (t.reissue) {
    const e = empById(t.reissue);
    if (!confirm(`Replace ${e.full_name}'s ID card?\n\nUse this if the card was lost or stolen. The OLD card will stop working immediately, and you will need to print a new one.`)) return;
    const token = crypto.randomUUID().replace(/-/g, '');
    const { error } = await sb.from('employees').update({ qr_token: token }).eq('id', e.id);
    if (error) return alert(error.message);
    toast('Old ID disabled — print the new card');
    window.open(`idcards.html?ids=${e.id}`, '_blank');
  }
  if (t.delete) {
    const e = empById(t.delete);
    const typed = prompt(`Delete ${e.full_name} permanently?\n\nThis also deletes ALL of their attendance records and their photo. It cannot be undone.\n(If they only resigned and you want to keep their records, click Cancel and use Edit → uncheck "Active" instead.)\n\nType their Employee ID (${e.employee_no}) to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== e.employee_no) return alert('Employee ID did not match — nothing was deleted.');
    const { error } = await sb.from('employees').delete().eq('id', e.id);
    if (error) return alert(error.message);
    await loadEmployees(); renderEmployees(); toast(`${e.full_name} deleted`);
  }
  if (t.clear) {
    if (!confirm('Delete this employee\'s face data? They will need to be enrolled again to use the kiosk.')) return;
    const { error } = await sb.from('employees').update({ face_descriptors: [], consent_at: null }).eq('id', t.clear);
    if (error) return alert(error.message);
    await loadEmployees(); renderEmployees(); toast('Face data removed');
  }
});

$('addEmp').addEventListener('click', () => openEmpForm(null));

async function openEmpForm(e) {
  $('empDialogTitle').textContent = e ? 'Edit employee' : 'Add employee';
  $('empId').value = e?.id || ''; $('empNo').value = e?.employee_no || ''; $('empName').value = e?.full_name || '';
  $('empDept').value = e?.department || ''; $('empPos').value = e?.position || '';
  $('empActive').checked = e ? e.active : true; $('empError').textContent = '';
  stopEmpCam(); setPhoto(null);
  $('empDialog').showModal();
  if (e?.has_photo) {
    const { data } = await sb.from('employees').select('photo').eq('id', e.id).single();
    setPhoto(data?.photo || null);
  }
}

// ---------- ID photo (camera / upload) ----------
let photoData = null, camStream = null;
function setPhoto(data) {
  photoData = data;
  $('empPhotoImg').classList.toggle('hidden', !data);
  $('empPhotoNone').classList.toggle('hidden', !!data);
  if (data) $('empPhotoImg').src = data; else $('empPhotoImg').removeAttribute('src');
}
function stopEmpCam() {
  camStream?.getTracks().forEach((t) => t.stop()); camStream = null;
  $('empCam').classList.add('hidden'); $('snapBtn').classList.add('hidden'); $('camBtn').classList.remove('hidden');
}
// center-crop to a square and shrink to a small JPEG
function toSquareJpeg(source, w, h, mirror = false) {
  const side = Math.min(w, h), size = 360;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.85);
}
$('camBtn').addEventListener('click', async () => {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (err) { return alert('Camera not available: ' + err.message); }
  const v = $('empCam'); v.srcObject = camStream; await v.play();
  $('empPhotoImg').classList.add('hidden'); $('empPhotoNone').classList.add('hidden');
  v.classList.remove('hidden'); $('snapBtn').classList.remove('hidden'); $('camBtn').classList.add('hidden');
});
$('snapBtn').addEventListener('click', () => {
  const v = $('empCam');
  setPhoto(toSquareJpeg(v, v.videoWidth, v.videoHeight, true));
  stopEmpCam();
});
$('photoFile').addEventListener('change', (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => { setPhoto(toSquareJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
  img.src = URL.createObjectURL(f);
  ev.target.value = '';
});
$('photoDel').addEventListener('click', () => { stopEmpCam(); setPhoto(null); });
$('empDialog').addEventListener('close', stopEmpCam);

$('empForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const row = {
    full_name: $('empName').value.trim(),
    department: $('empDept').value.trim() || null, position: $('empPos').value.trim() || null, active: $('empActive').checked,
    photo: photoData,
  };
  const id = $('empId').value;
  const { data: saved, error } = id
    ? await sb.from('employees').update(row).eq('id', id).select('id, employee_no').single()
    : await sb.from('employees').insert(row).select('id, employee_no').single();
  const newId = saved?.id;
  if (!error) { if (photoData) photos.set(newId, photoData); else photos.delete(newId); }
  if (error) return ($('empError').textContent = error.code === '23505' ? 'That Employee ID already exists.' : error.message);
  $('empDialog').close();
  await loadEmployees(); renderEmployees(); renderToday(); toast('Employee saved');
  if (!id && confirm(`Employee saved with ID ${saved.employee_no}. Open their ID card for printing now?`)) {
    const added = employees.find((x) => x.id === newId);
    if (added) window.open(`idcards.html?ids=${added.id}`, '_blank');
  }
});

// ---------------- face enrollment ----------------
let enrollEmp = null, enrollStream = null, face = null;

async function openEnroll(e) {
  enrollEmp = e;
  $('enrollName').textContent = e.full_name;
  $('consentBox').checked = false; $('enrollStart').disabled = true;
  $('enrollBar').style.width = '0';
  $('enrollHint').textContent = 'Loading camera and face models…';
  $('enrollDialog').showModal();
  try {
    face ??= await import('./face.js');
    await face.loadModels();
    enrollStream = await face.startCamera($('enrollVideo'));
    $('enrollHint').textContent = 'Good lighting, face the camera, no cap or sunglasses.';
  } catch (err) {
    $('enrollHint').textContent = '⚠ ' + (err.message || 'Could not start camera');
  }
}

$('consentBox').addEventListener('change', () => { $('enrollStart').disabled = !$('consentBox').checked || !enrollStream; });

function closeEnroll() { face?.stopCamera(enrollStream); enrollStream = null; $('enrollDialog').close(); }
$('enrollCancel').addEventListener('click', closeEnroll);
$('enrollDialog').addEventListener('cancel', () => { face?.stopCamera(enrollStream); enrollStream = null; });

$('enrollStart').addEventListener('click', async () => {
  $('enrollStart').disabled = true;
  const video = $('enrollVideo'), need = SETTINGS.enrollSamples, samples = [];
  const tips = ['Look straight at the camera', 'Turn your head slightly left', 'Turn your head slightly right', 'Tilt your chin up a little', 'Look straight again'];
  const deadline = Date.now() + 40000;
  while (samples.length < need && Date.now() < deadline) {
    $('enrollHint').textContent = tips[samples.length % tips.length] + '…';
    const dets = await face.detectFaces(video);
    if (dets.length === 1 && dets[0].detection.box.width > video.videoWidth * 0.25 && dets[0].detection.score > 0.7) {
      samples.push(face.toArray(dets[0].descriptor));
      $('enrollBar').style.width = (samples.length / need * 100) + '%';
      await new Promise((r) => setTimeout(r, 700));
    } else {
      $('enrollHint').textContent = dets.length > 1 ? 'Only one face should be in view' : 'Move closer and face the camera';
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (samples.length < need) { $('enrollHint').textContent = 'Timed out — check lighting and try again.'; $('enrollStart').disabled = false; return; }

  // Make sure this face isn't already enrolled under someone else
  const others = employees.filter((x) => x.id !== enrollEmp.id);
  const m = face.buildMatcher(others, 0.45);
  if (m) {
    const hit = m.findBestMatch(new Float32Array(samples[0]));
    if (hit.label !== 'unknown') {
      const who = empById(hit.label);
      if (!confirm(`Warning: this face looks like ${who.full_name} (${who.employee_no}). Save anyway?`)) { $('enrollStart').disabled = false; return; }
    }
  }

  const { error } = await sb.from('employees').update({ face_descriptors: samples, consent_at: new Date().toISOString() }).eq('id', enrollEmp.id);
  if (error) { $('enrollHint').textContent = '⚠ ' + error.message; $('enrollStart').disabled = false; return; }
  closeEnroll();
  await loadEmployees(); renderEmployees(); toast(`${enrollEmp.full_name} enrolled ✔`);
});

boot();
