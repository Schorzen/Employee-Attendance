// ID card kiosk: reads the QR on the employee's ID with the camera,
// or from a USB barcode/QR scanner (which types the code + Enter).
import jsQR from 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm';
import { sb } from './supabase.js';
import { startCamera } from './face.js';

import { QR_PREFIX } from './qr-prefix.js';
export { QR_PREFIX };

export async function startQrKiosk({ video, setStatus, showResult, isBusy }) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const recent = new Map(); // token -> time, avoids repeat scans of the same card
  let working = false;

  async function handle(raw) {
    const token = raw.trim().startsWith(QR_PREFIX) ? raw.trim().slice(QR_PREFIX.length) : null;
    if (!token) return setStatus('That QR code is not a Barangay Talisay ID', 'bad');
    const last = recent.get(token);
    if (working || isBusy() || (last && Date.now() - last < 6000)) return;
    working = true; recent.set(token, Date.now());
    setStatus('Recording…', 'ok');
    const { data, error } = await sb.rpc('record_punch_qr', { p_token: token });
    working = false;
    if (error) return showResult('dup', 'ERROR', '', '—', error.message);
    showResult(data);
  }

  // USB scanner support (acts like a keyboard)
  let buf = '', lastKey = 0;
  window.addEventListener('keydown', (e) => {
    const now = Date.now();
    if (now - lastKey > 100) buf = '';
    lastKey = now;
    if (e.key === 'Enter') { if (buf.length > 10) handle(buf); buf = ''; }
    else if (e.key.length === 1) buf += e.key;
  });

  try {
    await startCamera(video);
  } catch (e) {
    return setStatus('No camera — use a USB scanner, or allow camera access', 'wait');
  }
  setStatus('Show the QR code on your ID to the camera');

  const scan = () => {
    if (!working && !isBusy() && video.videoWidth) {
      const w = 480, h = Math.round(video.videoHeight * (w / video.videoWidth));
      canvas.width = w; canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) handle(code.data);
      else if (!working) setStatus('Show the QR code on your ID to the camera');
    }
    setTimeout(scan, 120);
  };
  scan();
}
