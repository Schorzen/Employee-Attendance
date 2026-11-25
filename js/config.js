// ======================================================================
//  App settings — edit these, then commit.
//  The publishable/anon key is SAFE to put here: it is public by design.
//  Your data is protected by the Row Level Security rules in supabase/schema.sql.
//  NEVER put the "service_role" / secret key in this file.
// ======================================================================
export const SUPABASE_URL = 'https://acswffglpevchssuwjhw.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_Ou2IF7ldaoRYAwD1gGH7Rg_KNuQ-Bok';

export const SETTINGS = {
  companyName: 'Employee Attendance',
  timezone: 'Asia/Manila',
  // Face match strictness: lower = stricter. 0.45–0.55 is typical.
  matchThreshold: 0.5,
  // Require a blink before clocking (stops someone holding up a photo).
  requireBlink: true,
  // How many face samples to capture when enrolling an employee.
  enrollSamples: 5,
  // Seconds the kiosk ignores the same person after a punch.
  kioskRepeatSeconds: 15,
};
