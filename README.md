# Barangay Talisay — Employee Attendance

**Clock-in method:** set `kioskMode` in `js/config.js`:
- `'qr'` (current): employees scan the **QR code on their ID card** at the kiosk camera, or with a USB QR scanner.
- `'face'`: face recognition with a blink/head-turn check.

## ID cards
- Admin → **Employees** → **ID card** (one employee) or **Print all ID cards**. Print at 100%, cut, put front and back together, then laminate.
- **Replace ID** creates a new QR and disables the old card right away. Use it for lost or stolen cards.
- **Logos:** upload the real files to the `img/` folder with these names: `barangay-talisay-seal.png`, `santa-fe-seal.png`, `bagong-pilipinas.png`.
- Update **2** of the database: run [`supabase/002_qr_id_cards.sql`](supabase/002_qr_id_cards.sql) once.

---


A free attendance system that runs on **GitHub Pages** + **Supabase**.

- **Kiosk** (`index.html`): a shared tablet/laptop at the entrance. Employees look at the camera and blink, and the kiosk records **TIME IN** or **TIME OUT** automatically, using the server's clock.
- **Admin** (`admin.html`): add employees, enroll faces, see who is in today, view and export records (CSV), and add manual entries.

Face recognition runs **in the browser** ([face-api.js](https://github.com/vladmandic/face-api)). **No photos are stored.** Only 128-number face templates are saved in the database.

---

## Setup (about 15 minutes)

### 1. Create the database
1. Supabase → **SQL Editor** → **New query**.
2. Paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.

### 2. Create the logins
1. Supabase → **Authentication → Users → Add user → Create new user**. Tick **Auto Confirm User**.
   - your **admin** account (e.g. `admin@company.com`)
   - a **kiosk** account (e.g. `kiosk@company.com`)
2. In the SQL Editor, give them their roles (change the emails first):
   ```sql
   insert into public.app_users (user_id, role)
   select id, 'admin' from auth.users where email = 'admin@company.com';

   insert into public.app_users (user_id, role)
   select id, 'kiosk' from auth.users where email = 'kiosk@company.com';
   ```
3. Authentication → Sign In / Providers → turn **off** "Allow new users to sign up". Only accounts you create should be able to log in.

### 3. Add your Supabase key
Supabase → **Project Settings → API Keys** → copy the **publishable** key (`sb_publishable_…`, or the legacy `anon` key).
Paste it into [`js/config.js`](js/config.js) as `SUPABASE_ANON_KEY`.
> ⚠️ Never paste the **secret / service_role** key into this project.

### 4. Turn on GitHub Pages
Repo → **Settings → Pages** → Source: **Deploy from a branch** → `main` / `(root)` → Save.
Your app will be at `https://schorzen.github.io/Employee-Attendance/`.

### 5. Use it
1. Open `…/admin.html` → sign in as admin → **Employees → Add employee → Enroll face**.
2. On the kiosk device, open `…/index.html` → sign in once with the kiosk account. It stays signed in.
3. Employees look at the camera, blink, and they're done.

---

## How it works
| Part | Detail |
|---|---|
| Time in / out | The first scan of the day is **IN**, the next is **OUT**, then IN again, and so on. Scans less than 2 minutes apart are ignored. |
| Anti-cheating | A blink is required (a printed photo can't blink). One face at a time. Uses the server's time, so changing the device clock does nothing. |
| Security | Row Level Security: only signed-in admin/kiosk accounts can read data. The kiosk can only record punches; it cannot view or edit records. |
| Tuning | `js/config.js`: `matchThreshold` (lower = stricter), `requireBlink`, `enrollSamples`. |

## Data Privacy Act (RA 10173)
Face templates are **sensitive personal information**. Before enrolling anyone:
- Have them sign the consent form ([`docs/biometric-consent-form.md`](docs/biometric-consent-form.md)).
- Use **Remove face** in Admin when an employee resigns or withdraws consent.
- Keep the admin password private, and give admin access to as few people as possible.

## Tips
- Put the kiosk in **good, even lighting**. Avoid a bright window behind people.
- Use Chrome. On a tablet, "Add to Home screen" makes it full screen.
- The camera needs **HTTPS**. GitHub Pages already provides it.
