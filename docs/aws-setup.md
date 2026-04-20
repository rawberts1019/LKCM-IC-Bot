# AWS setup — CTO one-pager

Run these in parallel with Week 1 development. As of April 2026, Bedrock serverless foundation models are **enabled on first invocation** — the old pre-request flow is gone — so the critical path is now the RDS + IAM setup.

Target state: a dedicated AWS account `lkcm-icbot-prod` containing an S3 bucket for raw documents, an RDS Postgres (pgvector) instance for app data, and Bedrock access to Claude. Application code running on Vercel will assume an IAM role via GitHub OIDC — **no long-lived access keys leave AWS**.

---

## 1. Create the dedicated account

- Sign up for a new AWS account at `aws.amazon.com`. Use a shared LKCM email alias (e.g. `aws-icbot@lkcm.com`) you can hand off later.
- Enable **MFA on the root user** (via Microsoft Authenticator).
- Set account name to `lkcm-icbot-prod`. Set billing alerts at $500 and $2,500/month.
- **Stop using root after this.** Create an IAM user `cto-admin` with the `AdministratorAccess` policy, sign in as that user, and forget the root password exists.

## 2. Pick a region

Recommend **`us-east-1`** unless you have a data-residency reason otherwise. Bedrock has the broadest Claude model availability there.

## 3. Activate Claude on Bedrock (takes ~5 minutes)

The old **Model access** page is retired. Serverless foundation models (including Claude) are enabled account-wide the first time you invoke them. You just need to invoke each Claude model once from the console.

1. Sign in to the new account, switch region to `us-east-1`.
2. Open the **Bedrock console** → **Model catalog**.
3. Find **Anthropic Claude Sonnet 4.6** → click it → **Open in playground**.
4. If prompted, fill in the **use-case details**:
   - Company: LKCM (Luther King Capital Management)
   - Industry: Private equity / asset management
   - Use case: Internal investment-committee assistant. Retrieval-augmented Q&A over firm-uploaded deal documents (IMs, CIMs, QoE, management presentations). Internal employees only; access gated by Microsoft Entra SSO.
   - Expected volume: low hundreds of requests per day during the prototype.
5. Send a one-line test message ("hello"). A response confirms the model is enabled account-wide.
6. Repeat for **Anthropic Claude Haiku 4.5** (used for cheaper extraction tasks).

Confirmation for me: once both models respond in the playground, we're done here. No approval wait.

> If your use-case form gets kicked back ("pending review"), ping me the exact message and I'll help reword it. It's rare with the text above.

## 4. S3 + KMS + RDS + IAM

The detailed CLI runbook with account-id-filled JSON is in [`../infra/aws/README.md`](../infra/aws/README.md). It covers:

- KMS CMKs for docs (`alias/lkcm-icbot-docs`) and database (`alias/lkcm-icbot-db`)
- S3 bucket `lkcm-icbot-docs-prod` (block public access, SSE-KMS, versioning, ownership enforced, lifecycle to Glacier Deep Archive after 90 days)
- RDS Postgres 16 + `vector` extension
- Two options for runtime credentials:
  - **Path A (recommended):** Vercel OIDC → role `arn:aws:iam::416689419695:role/lkcm-icbot-app`. Trust policy and permissions policy JSONs are in `infra/aws/iam/`, pre-filled with this account ID.
  - **Path B (fallback):** scoped IAM user `lkcm-icbot-app` with keys stored in Vercel env.

Permissions policy grants:
- `bedrock:InvokeModel` / `Converse` on Claude Sonnet 4.6 + Haiku 4.5 only
- `s3:GetObject` / `PutObject` / `DeleteObject` / `ListBucket` scoped to `lkcm-icbot-docs-prod`
- `kms:Decrypt` / `GenerateDataKey` only when invoked via S3
- `logs:*` under `/lkcm-icbot/*`

## 5. What I need from you before cutover

- [x] AWS account ID — **416689419695**
- [x] Region — **us-east-1**
- [x] Bedrock Claude Sonnet 4.6 + Haiku 4.5 confirmed working in the playground
- [ ] S3 bucket created (confirm name if not `lkcm-icbot-docs-prod`)
- [ ] RDS endpoint hostname (password stays on your side; `DATABASE_URL` goes into Vercel env)
- [ ] IAM role ARN — should be `arn:aws:iam::416689419695:role/lkcm-icbot-app`
- [ ] Vercel team slug (needed to fill `__TEAM_SLUG__` in `infra/aws/iam/trust-policy-vercel-oidc.json`)

Once I have the remaining four, cutover takes ~1 day. Real deal documents stay out of Vercel Blob / Anthropic direct API until cutover is complete.

## 6. Not in scope for the prototype (track for pilot)

- AWS Organizations + SCPs
- CloudTrail org trail → S3 → Athena for cross-account audit
- AWS Config + Security Hub baselines
- Private VPC + interface endpoints for Bedrock / S3
- KMS key rotation policy review
- Backup plan (RDS automated backups are on by default — confirm 7-day retention)

These are normal for production but out of scope for a 2–4 week prototype.
