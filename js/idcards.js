import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import { sb, getRole, esc } from './supabase.js';
import { SETTINGS } from './config.js';
import { QR_PREFIX } from './qr-prefix.js';

const o = SETTINGS.org;
const sheet = document.getElementById('sheet');

// Put the real logo files in the img/ folder with these names; missing ones are hidden.
const LOGOS = ['img/barangay-talisay-seal.png', 'img/santa-fe-seal.png', 'img/bagong-pilipinas.png'];

async function main() {
  if ((await getRole()) !== 'admin') {
    sheet.innerHTML = '<div class="msg">Please <a href="admin.html">sign in as admin</a> first.</div>';
    return;
  }
  const ids = new URLSearchParams(location.search).get('ids');
  let q = sb.from('employees').select('id, employee_no, full_name, department, position, qr_token, active').order('full_name');
  q = ids ? q.in('id', ids.split(',')) : q.eq('active', true);
  const { data, error } = await q;
  if (error) { sheet.innerHTML = `<div class="msg">${esc(error.message)}</div>`; return; }
  if (!data.length) { sheet.innerHTML = '<div class="msg">No employees found.</div>'; return; }
  document.getElementById('count').textContent = `ID Cards — ${data.length} employee${data.length > 1 ? 's' : ''}`;

  const logos = LOGOS.map((src) => `<img src="${src}" alt="" onerror="this.remove()">`).join('');
  const cards = await Promise.all(data.map(async (e) => {
    const qr = await QRCode.toString(QR_PREFIX + e.qr_token, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0A1F3D', light: '#FFFFFF' } });
    return `<div class="pair">
      <div class="card">
        <div class="head">
          <div class="logos">${logos}</div>
          <div class="gov">${esc(o.country)}<br>${esc(o.province)} · ${esc(o.municipality)}</div>
          <div class="brgy">${esc(o.name)}</div>
          <div class="label">EMPLOYEE ID</div>
        </div>
        <div class="stripe"></div>
        <label class="photo empty"><span>1×1 PHOTO</span><input type="file" accept="image/*" hidden></label>
        <div class="name">${esc(e.full_name)}</div>
        <div class="pos">${esc(e.position || '')}</div>
        <div class="dept">${esc(e.department || '')}</div>
        <div class="idno">ID NO. <b>${esc(e.employee_no)}</b></div>
      </div>
      <div class="card">
        <div class="bhead">${esc(o.name)} · EMPLOYEE ID</div>
        <div class="qr">${qr}</div>
        <div class="scan">Scan at the attendance kiosk</div>
        <div class="bid">${esc(e.full_name)} · ${esc(e.employee_no)}</div>
        <div class="note">This card is the property of ${esc(o.address.split(',')[0])} and is for attendance use only. It is non-transferable.
          If found, please return to the Barangay Hall, ${esc(o.address)}.</div>
        <div class="sign"><div class="line"></div><div class="who">${esc(o.signatory)}</div><div class="title">${esc(o.signatoryTitle)}</div></div>
      </div>
    </div>`;
  }));
  sheet.innerHTML = cards.join('');

  // local photo for printing only (not uploaded or saved)
  sheet.querySelectorAll('.photo input').forEach((inp) => inp.addEventListener('change', () => {
    const f = inp.files[0]; if (!f) return;
    const box = inp.parentElement;
    const r = new FileReader();
    r.onload = () => { box.classList.remove('empty'); box.querySelector('span').innerHTML = `<img src="${r.result}" alt="">`; };
    r.readAsDataURL(f);
  }));
}
main();
