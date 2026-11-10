# Kedai Rakdjat POS

**Local-first point of sale for a real Indonesian kedai** — built for an Android tablet cashier, with cloud monitoring for the owner and a kitchen display system. Works fully offline; syncs to Supabase when a connection is available.

![Layar kasir Kedai Rakdjat POS](docs/screenshot-kasir.png)

![Dashboard owner dengan grafik pemasukan](docs/screenshot-dashboard.png)

## Highlights

- **Offline-first cashier** — all transactions are written to IndexedDB (Dexie) first, so the register never stops when the internet does.
- **Dine-in table flow** — table map (available → occupied → cleaning), open orders per table, save-to-kitchen tickets, and temporary bills.
- **Shift management & cash reconciliation** — physical cash count per denomination, expected-vs-actual comparison, owner PIN authorization for discrepancies, QRIS/online income tracking.
- **Static QRIS payments** — shows the kedai's QRIS code; cashier confirms only after the merchant app/soundbox reports the payment.
- **Bluetooth thermal printing** — ESC/POS receipts, kitchen tickets, and temporary bills over Web Bluetooth.
- **Owner dashboard (cloud)** — today's revenue, payment mix, 7-day revenue trend, best-selling menu ranking, average ticket, and day-over-day growth — all rendered with dependency-free SVG charts.
- **Kitchen Display System (KDS)** — incoming → cooking → ready columns, live from the cloud.
- **PWA** — installable on the tablet home screen, standalone mode, precached app shell.
- **Backup & restore** — one-click JSON export/import of the entire local database.

## Tech stack

| Layer | Technology |
| --- | --- |
| UI | React 19 + TypeScript, Tailwind CSS v4 |
| Local data | Dexie (IndexedDB), local-first source of truth |
| Cloud | Supabase (PostgreSQL + Row Level Security), supabase-js |
| Printing | Web Bluetooth, ESC/POS |
| Charts | Hand-rolled SVG (no chart library) |
| Build | Vite + vite-plugin-pwa |
| Typography | Plus Jakarta Sans + Fraunces (bundled locally, offline-safe) |

## Architecture

The tablet is the **source of truth**. Every record is keyed by `(device_id, local_id)` and pushed to Supabase as upserts after each transaction. The owner dashboard and KDS read from the cloud, so they stay up to date without touching the register.

```
Tablet (cashier)                    Supabase (cloud)
┌─────────────────────┐   push     ┌──────────────────────┐
│ React + Dexie       │ ─────────► │ orders, payments,    │
│ offline-first POS   │  upserts   │ products, tables, …  │
└─────────────────────┘            └──────────┬───────────┘
                                              │ read
                              ┌───────────────┴───────────────┐
                              ▼                               ▼
                     Owner dashboard                    KDS (kitchen)
                     revenue & charts                   incoming/cooking/ready
```

`kds_status` lives only in the cloud and is omitted from push payloads, so kitchen progress is never overwritten by the tablet.

## Getting started

### 1. Install

```bash
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) in the SQL Editor.
3. Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
```

The publishable (anon) key is safe for client use. Alternatively, skip `.env` and fill in **Pengaturan → Koneksi Cloud** inside the app.

### 3. Run

```bash
npm run dev       # development
npm run build     # production build (PWA + service worker)
npm run preview   # serve the production build locally
```

Demo PINs: cashier `1111` · owner `1234`.

## Security notes

- Secrets are never committed: `.env` and data backups are gitignored.
- PINs are stored as salted hashes and are excluded from cloud sync.
- RLS is enabled on all tables. The current policies are permissive for `anon` — an intentional MVP trade-off for a single-owner private POS where the anon key acts as a shared secret. **Tighten to authenticated roles before any multi-tenant use.**

## Project structure

```
src/
├── screens/        Login, Cashier, Meja, Report (Keuangan), History,
│                   Cloud (owner dashboard), Kds, Settings
├── components/     SVG charts (bar, area, donut, rank bars)
├── db.ts           Dexie schema, seeds, PIN hashing
├── sync.ts         push-only upsert sync to Supabase
├── supabase.ts     client bootstrap + device identity
├── printer.ts      ESC/POS builders + Web Bluetooth transport
└── money.ts        integer-rupiah helpers
supabase/
└── migrations/     cloud schema (0001_init.sql)
```

## Roadmap

- [ ] Hardware verification of Bluetooth printer on the kedai's device
- [ ] Production PWA rollout on the cashier tablet
- [ ] Role-based RLS policies (owner / cashier / kitchen)
- [ ] Weekly & monthly report ranges in the owner dashboard

---

Built for **Kedai Rakdjat** · UI in Bahasa Indonesia