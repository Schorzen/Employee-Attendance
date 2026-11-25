import QRCode from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm';
import { sb, getRole, esc } from './supabase.js';
import { SETTINGS } from './config.js';
import { QR_PREFIX } from './qr-prefix.js';

const o = SETTINGS.org;
const sheet = document.getElementById('sheet');

const SEAL_BRGY = 'img/barangay-talisay-seal.png';
const SEAL_TOWN = 'img/santa-fe-seal.png';
const WAVE = (h, light) => `<svg class="wave" viewBox="0 0 200 ${h}" preserveAspectRatio="none" style="height:${h / 4}mm">
  <path d="M0 ${h * .38} C 40 ${h * .1}, 70 ${h * .62}, 110 ${h * .34} S 170 ${h * .12}, 200 ${h * .3} V ${h} H0Z" fill="${light}"/>
  <path d="M0 ${h * .55} C 45 ${h * .3}, 80 ${h * .8}, 125 ${h * .5} S 180 ${h * .32}, 200 ${h * .48} V ${h} H0Z" fill="#1F3A5F"/>
  <path d="M0 ${h * .75} C 50 ${h * .55}, 95 ${h * .95}, 140 ${h * .7} S 185 ${h * .6}, 200 ${h * .68} V ${h} H0Z" fill="#0A1F3D"/>
</svg>`;

async function main() {
  if ((await getRole()) !== 'admin') {
    sheet.innerHTML = '<div class="msg">Please <a href="admin.html">sign in as admin</a> first.</div>';
    return;
  }
  const ids = new URLSearchParams(location.search).get('ids');
  let q = sb.from('employees').select('id, employee_no, full_name, department, position, qr_token, active, photo').order('full_name');
  q = ids ? q.in('id', ids.split(',')) : q.eq('active', true);
  const { data, error } = await q;
  if (error) { sheet.innerHTML = `<div class="msg">${esc(error.message)}</div>`; return; }
  if (!data.length) { sheet.innerHTML = '<div class="msg">No employees found.</div>'; return; }
  document.getElementById('count').textContent = `ID Cards — ${data.length} employee${data.length > 1 ? 's' : ''}`;

  const cards = await Promise.all(data.map(async (e) => {
    const qr = await QRCode.toString(QR_PREFIX + e.qr_token, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0A1F3D', light: '#FFFFFF' } });
    return `<div class="pair">
      <div class="card">
        <div class="head">
          <div class="row">
            <img class="seal" src="${SEAL_BRGY}" alt="" onerror="this.style.visibility='hidden'">
            <div class="gov"><span class="rp">REPUBLIC OF THE PHILIPPINES</span><br>${esc(o.province)}<br>${esc(o.municipality)}</div>
            <img class="seal" src="${SEAL_TOWN}" alt="" onerror="this.style.visibility='hidden'">
          </div>
          <div class="brgy">${esc(o.name)}</div>
          <div class="town">SANTA FE · CEBU</div>
        </div>
        <div class="stripe"></div>
        <div class="body">
          <img class="wm" src="${SEAL_BRGY}" alt="" onerror="this.remove()">
          ${e.photo ? `<div class="photo"><img src="${e.photo}" alt=""></div>` : '<label class="photo empty"><span>1×1 PHOTO</span><input type="file" accept="image/*" hidden></label>'}
          <div class="name">${esc(e.full_name)}</div>
          ${e.position ? `<div class="pos">${esc(e.position)}</div>` : ''}
          ${e.department ? `<div class="dept">${esc(e.department)}</div>` : ''}
        </div>
        <div class="foot">${WAVE(54, '#1F6FB2')}<div class="lbl">EMPLOYEE NO.</div><div class="no">${esc(e.employee_no)}</div></div>
      </div>
      <div class="card">
        <div class="bhead">
          <img class="seal" src="${SEAL_BRGY}" alt="" onerror="this.remove()">
          <div><div class="t1">${esc(o.name)}</div><div class="t2">EMPLOYEE ID</div></div>
        </div>
        <div class="stripe"></div>
        <div class="qrwrap">${qr}</div>
        <div class="scan">SCAN TO TIME IN / OUT</div>
        <dl class="info"><dt>Name</dt><dd>${esc(e.full_name)}</dd><dt>Employee No.</dt><dd>${esc(e.employee_no)}</dd></dl>
        <div class="note">This card is the property of ${esc(o.address.split(',')[0])} and is non-transferable.
          If found, please return to the Barangay Hall, ${esc(o.address)}.</div>
        <div class="sign"><img class="sig" src="img/signature.png?v=2" alt="" onerror="this.remove()"><div class="line"></div><div class="who">${esc(o.signatory)}</div><div class="title">${esc(o.signatoryTitle)}</div></div>
        <div class="bfoot">${WAVE(28, '#1F6FB2')}</div>
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
