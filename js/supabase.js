import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SETTINGS } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const keyMissing = !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith('PASTE_');

export async function getRole() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('app_users').select('role')
    .eq('user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data?.role ?? 'none';
}

const tz = SETTINGS.timezone;
export const fmtTime = (d) => new Date(d).toLocaleTimeString('en-PH', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d) => new Date(d).toLocaleDateString('en-PH', { timeZone: tz, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
// YYYY-MM-DD for "today" in the company timezone
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: tz });

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Fetch every row of a query (Supabase returns max 1000 per request)
export async function fetchAll(buildQuery, pageSize = 1000) {
  let from = 0, rows = [];
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data);
    if (data.length < pageSize) return rows;
    from += pageSize;
  }
}
