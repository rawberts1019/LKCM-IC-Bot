# LKCM IC Bot

Investment committee assistant for LKCM. Deal teams upload documents into per-deal workspaces; IC members ask questions in a threaded chat and get cited answers. Low-confidence or sensitive questions route to the deal team for review before the asker sees them.

This repo is the **Week 1 scaffold** of the 2–4 week prototype. It includes the data model, Entra SSO, access control, audit log, and all page skeletons. Ingestion (PDF/DOCX/PPTX/XLSX + scanned-PDF OCR), retrieval, and Claude-powered answering land in weeks 2–3.

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **Tailwind v4**
- **NextAuth v5** with the **Microsoft Entra ID** provider (Authenticator MFA via Entra conditional access)
- **Postgres 16 + pgvector** via **Prisma** (Neon locally day-1, RDS after AWS cutover)
- **Claude** via Anthropic API (days 1–14) → **AWS Bedrock** (day ~10 onward)
- **Storage**: local filesystem / Vercel Blob (days 1–14) → S3 in the LKCM AWS account

See [`docs/aws-setup.md`](docs/aws-setup.md) for the CTO one-pager on standing up the AWS account in parallel.

## Local development

### Prerequisites

- Node 20+
- Postgres 16 with the `vector` extension (Docker snippet below works)
- An Entra App Registration (see [`docs/entra-setup.md`](docs/entra-setup.md))

### Start Postgres

```bash
docker run --name lkcm-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d pgvector/pgvector:pg16
```

### Install, migrate, run

```bash
cp .env.example .env
# fill in NEXTAUTH_SECRET, AZURE_AD_*, ADMIN_EMAILS, ANTHROPIC_API_KEY
npm install
npm run db:push        # creates schema against DATABASE_URL
npm run dev            # http://localhost:3000
```

First sign-in via Entra auto-creates your user row. Emails listed in `ADMIN_EMAILS` (comma-separated, lowercased) get the `admin` role.

## Project layout

```
src/
  auth.ts                      NextAuth v5 config (Entra provider, JWT session, role claim)
  middleware.ts                Redirects unauthenticated users to /login
  env.ts                       Zod-validated environment variables
  lib/
    db.ts                      Prisma client singleton
    access.ts                  requireUser / requireAdmin / requireWorkspaceAccess guards
    audit.ts                   Append-only audit log writer
    utils.ts                   cn(), formatBytes(), formatDateTime()
  app/
    login/                     /login
    (app)/                     Authenticated routes (layout with header + sign-out)
      deals/                   List, create, detail, upload, chat, review queue
      admin/                   Admin home, users, audit log
    api/auth/[...nextauth]/    NextAuth route handlers
prisma/
  schema.prisma                Workspaces, members, docs, chunks, threads, messages,
                               review queue, audit log. Vector column on chunks.
  migrations/0000_init/        Enables the pgvector extension.
docs/
  aws-setup.md                 CTO checklist for standing up AWS (run in parallel).
  entra-setup.md               App Registration steps and redirect URIs.
```

## Access model (enforced today)

- A user can see a deal workspace **only if** they are a `WorkspaceMember` of it — or are a firm `admin`.
- Members have a per-workspace role: `owner`, `dealteam`, or `ic`.
- Deal-team members (`owner` / `dealteam`) can upload docs, add members, and work the review queue. `ic` members can only ask and read.
- Every meaningful action writes an append-only row to `AuditLog`, viewable at `/admin/audit`.

## What's stubbed, and when it lands

| Surface | State | Lands |
|---|---|---|
| Entra SSO + roles | **Live** | Week 1 |
| Create/list/view deals, member management | **Live** | Week 1 |
| Audit log write + admin viewer | **Live** | Week 1 |
| File upload (UI + storage provider + status) | Stub UI | Week 2 |
| Ingestion pipeline (PDF/DOCX/PPTX/XLSX + OCR via Claude vision) | Schema only | Week 2 |
| Retrieval + Claude answering + citations | Schema + UI shell | Week 2 |
| Confidence routing + deal-team review queue | Schema + list UI | Week 2 |
| AWS cutover (S3 + RDS + Bedrock) | Config flags in place | Week 3 |

## Scripts

```bash
npm run dev         # Next dev server
npm run build       # prisma generate && next build
npm run typecheck   # tsc --noEmit
npm run db:push     # push Prisma schema to DATABASE_URL (no migration file)
npm run db:migrate  # create a migration
npm run db:studio   # Prisma Studio browser
```

## Branch

All development happens on `claude/investment-chatbot-app-7kX4e` per the project convention. Push to `main` only after pilot sign-off.
