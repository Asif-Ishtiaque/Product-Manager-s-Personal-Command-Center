# Tide (web) — production app

Next.js 16 (App Router) · Auth.js v5 · Prisma 6 · Postgres · Tailwind v4.

The production version of Tide: real passwordless auth, a Postgres-backed
unified attention feed, and OAuth integrations (Notion first, then
Jira / Figma / ClickUp / Slack). Tokens are encrypted at rest; secrets never
reach the browser.

## Architecture

```
web/
├── auth.ts                     Auth.js config (Google + email magic link)
├── proxy.ts                    Route gate (Next 16 middleware -> proxy)
├── prisma/schema.prisma        Users, sessions, connections, items, links
├── lib/
│   ├── prisma.ts               Prisma client singleton
│   ├── encryption.ts           AES-256-GCM for tokens at rest
│   ├── sla.ts                  Staleness / urgency / My-Day logic
│   └── notion.ts               Notion OAuth exchange + sync
├── app/
│   ├── login/                  Passwordless sign-in
│   ├── board/                  The attention feed (reads from Postgres)
│   └── api/
│       ├── auth/[...nextauth]  Auth.js handlers
│       ├── connect/notion/     OAuth start + callback
│       └── sync/               Re-pull connected sources
```

## Setup

1. Install (done if you scaffolded): `npm install`
2. Env: `cp .env.example .env.local` and fill in:
   - Neon Postgres -> `DATABASE_URL` (pooled) + `DIRECT_URL` (direct). neon.tech, free tier.
   - `AUTH_SECRET` -> `npx auth secret`
   - `ENCRYPTION_KEY` -> `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   - Google OAuth -> Cloud Console; redirect `http://localhost:3000/api/auth/callback/google`
   - Resend -> API key for magic-link email (free tier)
   - Notion -> notion.so/my-integrations (Public integration); redirect `http://localhost:3000/api/connect/notion/callback`
3. Database: `npx prisma migrate dev --name init`
4. Run: `npm run dev` -> http://localhost:3000

## Deploy (Vercel)

- Set the project Root Directory to `web`.
- Add all `.env.local` vars as Vercel env vars (production URLs for
  `NEXTAUTH_URL`, the Google redirect, and `NOTION_REDIRECT_URI`).
- Run `prisma migrate deploy` against the production DB.

## Adding the next integration

Clone the Notion pattern: a `lib/<source>.ts` with authorizeUrl + exchangeCode
+ save<Source>Connection + sync<Source>, two routes under
`app/api/connect/<source>/`, and a fan-out line in `app/api/sync/route.ts`.
