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

## 4. Create the S3 bucket for raw documents

- Bucket name: `lkcm-icbot-docs-prod` (bucket names are global; adjust if taken).
- Region: `us-east-1`.
- **Block all public access**: on.
- **Default encryption**: SSE-KMS with a CMK named `lkcm-icbot-docs`. Create the CMK if needed.
- **Versioning**: enabled (recoverability for accidental deletes; also supports WORM later).
- **Object ownership**: bucket owner enforced (disable ACLs).
- Add a lifecycle rule to transition non-current versions to Glacier Deep Archive after 90 days (cost control on document revisions).

## 5. Create the RDS Postgres instance

- Engine: **Postgres 16**.
- Instance: `db.t4g.small` (upgradeable; fine for the prototype).
- Storage: 20 GB gp3, encrypted with a CMK `lkcm-icbot-db`.
- VPC: default VPC for the prototype; move to a private VPC before go-live.
- Public access: **off**. We'll reach it via Vercel's IP allow-list or (preferably) an RDS Proxy + AWS Private Link once we move the app into AWS.
- Database name: `lkcm_icbot`.
- After creation: connect once and run `CREATE EXTENSION vector;`. The first migration file does this too, but the extension must be installable — confirm `shared_preload_libraries` includes `vector` on the parameter group (default is fine on Postgres 16 RDS).

Save the connection string as `DATABASE_URL` in Vercel's project env (encrypted).

## 6. Create the IAM role for GitHub / Vercel (OIDC)

Do **not** create long-lived access keys. Instead:

1. IAM → **Identity providers** → **Add provider** → OIDC.
   - Provider URL: `https://token.actions.githubusercontent.com` (for GitHub Actions) and/or `https://oidc.vercel.com` (for Vercel).
   - Audience: `sts.amazonaws.com`.
2. IAM → **Roles** → **Create role** → Web identity.
   - Trusted entity: the OIDC provider from step 1.
   - Trust policy limits the role to the `rawberts1019/lkcm-ic-bot` repo and `claude/*` branches.
3. Attach a **least-privilege policy** (inline) allowing:
   - `s3:GetObject`, `s3:PutObject`, `s3:ListBucket` on `arn:aws:s3:::lkcm-icbot-docs-prod/*`
   - `kms:Decrypt`, `kms:GenerateDataKey` on the two CMKs above
   - `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on the two Claude model ARNs
   - `logs:*` on `arn:aws:logs:*:*:log-group:/lkcm-icbot/*`

I'll send the exact JSON trust policy + permissions policy once you tell me the AWS account ID.

## 7. What I need from you before cutover

- [ ] AWS account ID
- [ ] Region confirmation (recommend `us-east-1`)
- [ ] The S3 bucket name (if not `lkcm-icbot-docs-prod`)
- [ ] Confirmation that Claude Sonnet 4.6 **and** Claude Haiku 4.5 both respond in the Bedrock playground
- [ ] `DATABASE_URL` to the RDS instance (added to Vercel env — never checked in)
- [ ] IAM role ARN for OIDC assumption

Once I have those six, cutover takes ~1 day. Real deal documents stay out of Vercel Blob / Anthropic direct API until cutover is complete.

## 8. Not in scope for the prototype (track for pilot)

- AWS Organizations + SCPs
- CloudTrail org trail → S3 → Athena for cross-account audit
- AWS Config + Security Hub baselines
- Private VPC + interface endpoints for Bedrock / S3
- KMS key rotation policy review
- Backup plan (RDS automated backups are on by default — confirm 7-day retention)

These are normal for production but out of scope for a 2–4 week prototype.
