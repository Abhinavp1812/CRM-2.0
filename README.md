# Style Lounge CRM

A full-stack CRM built for Style Lounge to manage customer follow-ups, bookings, and agent teams. Built with Next.js 16, React 19, Prisma, PostgreSQL, and NextAuth v5.

---

## Features

### For Agents
- **Followups dashboard** — see today's follow-ups across filters: All, Cold, Booked, Today, Pipeline, Action Required, Registered, Booked (type). Paginated (50 per page).
- **Customer search** — search across all assigned customers by name, phone, or city.
- **Customer detail** — full booking history, registration history, activity log, and follow-up timeline per customer.
- **Log a call** — record a remark + note + next follow-up date. Smart defaults per remark (e.g. "No answer" → +2 days, "Booked" → +20 days).
- **WhatsApp / Call buttons** — one-click WhatsApp and phone dial from any row.
- **My Stats** — agent-level stats page.
- **Self leave** — agents can mark themselves on leave from the sidebar.

### For Admins
- **All Followups (Team View)** — same dashboard but shows the full team's workload with owner column.
- **Customers** — full customer directory with search.
- **Admin dashboard** — overview of team and system.
- **Team management**:
  - Add agents (name, email, password set by admin)
  - Edit agent details and reset passwords
  - Mark agent on leave (followups in the leave window are automatically pushed to their return date)
  - Bring agent back from leave
  - Reassign customers — to a specific agent or round-robin across the team
  - Remove agent (must reassign customers first)
  - Balance team — redistributes all customers evenly across active agents
- **Data Sync — Registrations** — pulls the "New Customers" Google Sheet directly (no file uploads); new customers are assigned to the least-loaded agent; existing customers keep their current agent.
- **Data Sync — Bookings** — pulls the "Booking Dump" Google Sheet; known order numbers are skipped; customers who already exist keep their agent; NEW_REGISTRATION customers are upgraded to CUSTOMER type; followup dates set to booking date + 20 days.
- **Scheduled sync** — a Vercel Cron job runs both syncs once a day; admins can also press "Sync now" any time.
- **Safe to re-run** — syncs are idempotent (dedupe by phone and by Order No.), write in chunks of 1,000 rows, and end by giving any customer without a followup date one, so nobody falls out of the agent queues.
- **Error report download** — after any sync, download a `.xlsx` report of rows that could not be used, with the original data and reason.
- **Data Sync hub** — per-agent customer breakdown with share bar, and full sync history (last 20 runs).
- **Closed Followups** — view completed/closed follow-ups.
- **Team Stats** — team-wide performance statistics.

### Assignment Logic
- **New customers** (no existing record) → assigned to the active, non-leave agent with the fewest customers
- **Existing customers** (already in DB) → always keep their current agent (sticky ownership)
- **Booking import upgrades** a NEW_REGISTRATION → CUSTOMER without changing the owner

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| UI | React 19, Tailwind CSS 4, Heroicons |
| Auth | NextAuth v5 (Credentials + JWT) |
| ORM | Prisma 6 |
| Database | PostgreSQL 16 |
| File parsing | xlsx (CSV + XLSX) |
| Password hashing | bcryptjs |

---

## Security

- **No credentials in the codebase.** All secrets live in `.env` which is gitignored.
- **Passwords hashed** with bcrypt (cost factor 10) before storage. Plaintext passwords are never stored.
- **Super Admin** — an emergency bypass account defined entirely in `.env`. It never touches the database. Use it if the admin DB account is compromised or forgotten.
- **Role-based access control** — every API route and page checks the JWT role (ADMIN or AGENT). Agents cannot access admin routes.
- **JWT sessions** — 30-day expiry, stored client-side. No server-side session store needed.
- **Agents are created by admin only** — there is no public signup. Admin creates agents from the Team page.
- **On login**, if a user was marked on leave, their leave status is automatically cleared.

---

## Running on a New Machine

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL) — or an existing PostgreSQL 16 instance

### 1. Clone the repo

```bash
git clone https://github.com/Abhinavp1812/CRM-2.0.git
cd CRM-2.0
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create `.env`

Create a `.env` file in the project root. **Never commit this file.**

```env
# PostgreSQL connection string
DATABASE_URL="postgresql://crm:YOUR_DB_PASSWORD@localhost:5432/crm?schema=public"

# NextAuth — generate with: openssl rand -base64 32
AUTH_SECRET="your-random-secret-here"
AUTH_TRUST_HOST=true
NEXTAUTH_URL=http://localhost:3000

# Super admin — bypasses the database entirely, for emergency access only
SUPER_ADMIN_EMAIL=superadmin@crm.local
SUPER_ADMIN_PASSWORD=your-strong-super-admin-password

# Seed credentials — used only when running `npx prisma db seed`
SEED_ADMIN_EMAIL=admin@crm.local
SEED_ADMIN_PASSWORD=your-admin-password
```

**Generate `AUTH_SECRET`:**
```bash
# On Linux/Mac:
openssl rand -base64 32

# On Windows (PowerShell):
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### 4. Start the database

If using Docker:

```bash
# Set the DB password (must match DATABASE_URL above)
# On Linux/Mac:
export POSTGRES_PASSWORD=YOUR_DB_PASSWORD

# On Windows (PowerShell):
$env:POSTGRES_PASSWORD="YOUR_DB_PASSWORD"

docker compose up -d
```

If using an existing PostgreSQL instance, create a database and user manually and update `DATABASE_URL` accordingly.

### 5. Run migrations

```bash
npx prisma migrate deploy
```

### 6. Seed the database

This creates the admin account and remark options. Agents are created later through the Admin UI.

```bash
npx prisma db seed
```

After seeding, log in with the credentials you set in `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

### 7. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 8. Add agents

1. Log in as admin
2. Go to **Admin → Team → Add Agent**
3. Enter name, email, and initial password for each agent
4. Share the credentials with your agents — they can change their password from the Team page later

---

## Production Build

```bash
npm run build
npm start
```

For production, also set `NEXTAUTH_URL` to your actual domain.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH_SECRET` | Yes | Random secret for signing JWTs. Min 32 chars. |
| `AUTH_TRUST_HOST` | Yes | Set to `true` |
| `NEXTAUTH_URL` | Yes | Full URL of the app (e.g. `http://localhost:3000`) |
| `SUPER_ADMIN_EMAIL` | Yes | Emergency admin email. Never stored in DB. |
| `SUPER_ADMIN_PASSWORD` | Yes | Emergency admin password. Never stored in DB. |
| `SEED_ADMIN_EMAIL` | Yes | Admin email created when running `prisma db seed` |
| `SEED_ADMIN_PASSWORD` | Yes | Admin password created when running `prisma db seed` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes (for sync) | Full contents of the Google service-account JSON key. The sheets must be shared with its `client_email` as Viewer. Alternative: `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`. |
| `CRON_SECRET` | For scheduled sync | Random string; Vercel Cron sends it as a bearer token to `/api/cron/sync`. |
| `REGISTRATIONS_SHEET_ID` | No | Overrides the registrations spreadsheet (ID or full URL). |
| `REGISTRATIONS_SHEET_TABS` | No | Comma-separated tab names to sync (default `Delhi/NCR`). |
| `BOOKINGS_SHEET_ID` | No | Overrides the bookings spreadsheet (ID or full URL). |
| `BOOKINGS_SHEET_TABS` | No | Comma-separated tab names to sync (default `Sheet1`). |

---

## Resetting the Database

To wipe all data and start fresh (drops tables, re-runs migrations and seed):

```bash
npx prisma migrate reset
```

---

## Project Structure

```
src/
  app/
    page.tsx                        # Followups dashboard (home)
    admin/                          # Admin-only pages
      page.tsx                      # Admin dashboard
      team/                         # Team management
      imports/                      # Data Sync hub (sync buttons, history, agent breakdown)
      import/followups/             # One-time migration of the old followup spreadsheet
      stats/                        # Team stats
      closed-followups/             # Closed followups
    customers/                      # Customer list + detail
    stats/                          # Agent stats
    login/                          # Login page
    api/                            # All API routes
  components/                       # Shared UI components
  lib/                              # Prisma client, Google Sheets client, sync importers, utilities
  lib/sync/                         # registrations + bookings sync logic, owner assignment
  auth.ts                           # NextAuth config + super admin logic
  types/                            # TypeScript type extensions
prisma/
  schema.prisma                     # Database schema
  seed.ts                           # Seeds admin account + remark options
  migrations/                       # SQL migration history
```
