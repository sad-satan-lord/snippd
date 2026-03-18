# Gistly

A minimal, self-hosted code snippet sharing tool built for Vercel's Hobby plan. Paste code, get a shareable link. Raw file URLs are always public; everything else can be gated behind a password.

---

## Features

- **Multi-file gists** — up to 20 files per gist, each up to 500 KB
- **Syntax highlighting** — server-side via [Shiki](https://shiki.matsu.io), 30+ languages, no client-side flicker
- **Auto language detection** — inferred from file extension on filename input
- **Raw file access** — `GET /api/raw/:id/:filename` returns plain text, always public
- **Password protection** — optional site-wide login gate via Edge middleware; raw URLs bypass it
- **Expiring gists** — optional TTL of 1 day, 7 days, or 30 days
- **Rate limiting** — sliding window (10 gists/hour/IP) via Vercel KV
- **Recent gists feed** — `GET /api/recent` with 30-second ISR cache
- **Tab key support** — inserts 2 spaces in the editor, no focus trapping

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Database | Vercel Postgres (Neon) |
| Cache / Rate limit | Vercel KV (Upstash Redis) |
| Highlighting | Shiki 1.x (server component) |
| Deployment | Vercel Hobby |

All Vercel services used (Postgres, KV) have a free tier that fits comfortably within Hobby plan limits.

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/route.ts          # POST login / logout
│   │   ├── gists/route.ts         # POST create gist
│   │   ├── gists/[id]/route.ts    # GET gist by ID (increments views)
│   │   ├── raw/[id]/[filename]/   # GET raw file — always public
│   │   └── recent/route.ts        # GET recent gists list
│   ├── login/
│   │   ├── page.tsx               # Password login UI
│   │   └── page.module.css
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                   # New gist editor
├── components/
│   ├── Header.tsx
│   ├── Header.module.css
│   └── LogoutButton.tsx
├── lib/
│   ├── auth.ts                    # HMAC-SHA256 token derivation (Edge-safe)
│   ├── db.ts                      # Schema types + initDB()
│   ├── highlight.ts               # Shiki singleton
│   ├── rate-limit.ts              # Sliding window rate limiter (KV)
│   └── utils.ts                   # ID generation, language detection
└── middleware.ts                  # Edge auth gate
```

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/your-username/gistly
cd gistly
npm install
```

### 2. Create Vercel services

In the [Vercel dashboard](https://vercel.com/dashboard), under your project's **Storage** tab:

- **Add → Postgres** — creates a Neon database and injects `POSTGRES_*` env vars
- **Add → KV** — creates an Upstash Redis store and injects `KV_*` env vars

Both are free on the Hobby plan.

### 3. Configure environment variables

Copy the example file and fill in the values pulled from Vercel:

```bash
cp .env.example .env.local
```

The Postgres and KV variables are automatically available in Vercel deployments once the stores are linked. You only need to set them locally for `npm run dev`.

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_URL` | Yes | Injected by Vercel Postgres |
| `POSTGRES_*` | Yes | Other Postgres vars injected automatically |
| `KV_REST_API_URL` | Yes | Injected by Vercel KV |
| `KV_REST_API_TOKEN` | Yes | Injected by Vercel KV |
| `NEXT_PUBLIC_APP_URL` | Yes | Your deployment URL (e.g. `https://gistly.vercel.app`) |
| `SITE_PASSWORD` | No | Enables password gate. Leave unset for public access |
| `AUTH_SALT` | No | Secret salt for session tokens. Change to invalidate all sessions |

### 4. Initialize the database

The database table is created automatically on the first gist creation via `initDB()`. If you prefer to run it manually, connect to your Neon database and execute:

```sql
CREATE TABLE IF NOT EXISTS gists (
  id          TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  files       JSONB NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gists_created_at_idx ON gists (created_at DESC);
```

### 5. Run locally

```bash
npm run dev
# → http://localhost:3000
```

### 6. Deploy

```bash
# Via Vercel CLI
npx vercel --prod

# Or push to a GitHub repo connected to Vercel — it deploys automatically
```

---

## Password Protection

When `SITE_PASSWORD` is set, all routes require a valid session cookie **except**:

| Path | Always public |
|---|---|
| `/api/raw/:id/:filename` | Raw file download |
| `/api/auth` | Login / logout endpoint |
| `/login` | Login page |

### How it works

1. On login, the server derives a token: `HMAC-SHA256(SITE_PASSWORD, AUTH_SALT)`, hex-encoded
2. The token is stored in an `httpOnly; Secure; SameSite=lax` cookie (30-day expiry)
3. Edge middleware checks the cookie on every request before it reaches any page or API handler
4. The "lock" button in the header calls `POST /api/auth` with `{ action: "logout" }` to clear the cookie

### Invalidating sessions

Change `AUTH_SALT` in your environment variables. All existing cookies will fail validation and users will be redirected to `/login`.

---

## API Reference

### `POST /api/gists`

Create a new gist.

**Request body:**
```json
{
  "description": "optional description",
  "files": [
    {
      "filename": "main.py",
      "content": "print('hello')",
      "language": "python"
    }
  ],
  "expiresIn": "7d"
}
```

- `files` — required, 1–20 items, each up to 500 KB
- `language` — optional; auto-detected from filename if omitted
- `expiresIn` — optional; `"1d"`, `"7d"`, `"30d"`, or omit for no expiry

**Response `201`:**
```json
{ "id": "a1b2c3d4" }
```

**Rate limit:** 10 requests per hour per IP. Returns `429` with a `Retry-After` header when exceeded.

---

### `GET /api/gists/:id`

Fetch a gist by ID. Increments the view counter. Returns `404` if not found or expired.

**Response `200`:**
```json
{
  "id": "a1b2c3d4",
  "description": "...",
  "files": [
    { "filename": "main.py", "content": "...", "language": "python" }
  ],
  "views": 12,
  "created_at": "2025-01-01T00:00:00Z",
  "expires_at": null
}
```

---

### `GET /api/raw/:id/:filename`

Returns the raw file content as `text/plain`. Always public — no auth required.

```
https://gistly.vercel.app/api/raw/a1b2c3d4/main.py
```

---

### `GET /api/recent`

Returns the 20 most recent non-expired gists. File contents are omitted; only metadata is returned.

```json
[
  {
    "id": "a1b2c3d4",
    "description": "...",
    "files": [
      { "filename": "main.py", "language": "python", "lines": 42, "size": 1024 }
    ],
    "views": 5,
    "created_at": "2025-01-01T00:00:00Z"
  }
]
```

Cached at the edge for 30 seconds (`s-maxage=30, stale-while-revalidate=60`).

---

## Supported Languages

`bash` · `c` · `cpp` · `csharp` · `css` · `dockerfile` · `go` · `graphql` · `html` · `java` · `javascript` · `json` · `jsx` · `kotlin` · `lua` · `markdown` · `php` · `plaintext` · `python` · `r` · `ruby` · `rust` · `scss` · `sql` · `swift` · `toml` · `tsx` · `typescript` · `xml` · `yaml`

---

## Hobby Plan Limits

Gistly is designed to stay within Vercel's free Hobby tier:

| Resource | Hobby limit | Gistly usage |
|---|---|---|
| Serverless function duration | 10s | All routes are fast DB/KV reads |
| Edge middleware | Included | Auth middleware runs at edge |
| Vercel Postgres | 256 MB storage, 60 hrs compute/month | ~1 KB per gist row |
| Vercel KV | 30k requests/day, 256 MB | ~2 KV ops per gist creation |
| Bandwidth | 100 GB/month | Raw files served as text |

For heavier usage, consider moving to Vercel Pro or self-hosting the Postgres/Redis layer.

---

## License

MIT
