# AWS infrastructure — runbook

Target account: **`416689419695` (`lkcm-icbot-prod`)**
Target region: **`us-east-1`**

Bedrock model access for Claude Sonnet 4.6 and Haiku 4.5 is confirmed. This runbook stands up the remaining pieces: S3 bucket, RDS Postgres (pgvector), and the IAM role that Vercel will assume at runtime to reach Bedrock and S3.

Two paths for the runtime credentials. **Pick one:**

- **Path A — Vercel OIDC (recommended).** No long-lived keys. Needs ~15 min of setup in both Vercel and AWS.
- **Path B — Scoped IAM user.** Simpler; long-lived keys in Vercel env. Acceptable for the prototype, rotate before pilot. See `iam/trust-policy-iam-user-fallback.md`.

All commands below use the AWS CLI. Console equivalents are obvious; CLI is tighter and auditable.

---

## Prerequisites

```bash
aws configure --profile lkcm-icbot-admin
# enter CTO admin keys; region us-east-1; output json
export AWS_PROFILE=lkcm-icbot-admin
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=416689419695
```

---

## 1. KMS keys

Separate keys for documents vs. database. Both scoped to the account.

```bash
# Docs key
aws kms create-key \
  --description "lkcm-icbot documents" \
  --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT \
  --tags TagKey=app,TagValue=lkcm-icbot TagKey=purpose,TagValue=docs

aws kms create-alias \
  --alias-name alias/lkcm-icbot-docs \
  --target-key-id <KEY_ID_FROM_ABOVE>

# DB key (same pattern)
aws kms create-key --description "lkcm-icbot database" \
  --tags TagKey=app,TagValue=lkcm-icbot TagKey=purpose,TagValue=db
aws kms create-alias --alias-name alias/lkcm-icbot-db \
  --target-key-id <KEY_ID_FROM_ABOVE>
```

## 2. S3 bucket

```bash
aws s3api create-bucket \
  --bucket lkcm-icbot-docs-prod \
  --region us-east-1

aws s3api put-public-access-block \
  --bucket lkcm-icbot-docs-prod \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws s3api put-bucket-versioning \
  --bucket lkcm-icbot-docs-prod \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket lkcm-icbot-docs-prod \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "alias/lkcm-icbot-docs"
      },
      "BucketKeyEnabled": true
    }]
  }'

aws s3api put-bucket-ownership-controls \
  --bucket lkcm-icbot-docs-prod \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
```

Optional lifecycle rule — transition non-current versions to Glacier Deep Archive after 90 days:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket lkcm-icbot-docs-prod \
  --lifecycle-configuration file://infra/aws/s3/lifecycle.json
```

## 3. RDS Postgres

Replace `<STRONG_PASSWORD>` with a freshly-generated one stored in 1Password / your secret manager. You'll also need a DB subnet group and security group — the console wizard is faster here; CLI skeleton shown for completeness.

```bash
aws rds create-db-instance \
  --db-instance-identifier lkcm-icbot-db \
  --engine postgres --engine-version 16.4 \
  --db-instance-class db.t4g.small \
  --allocated-storage 20 --storage-type gp3 \
  --storage-encrypted --kms-key-id alias/lkcm-icbot-db \
  --master-username lkcmicbot --master-user-password '<STRONG_PASSWORD>' \
  --db-name lkcm_icbot \
  --vpc-security-group-ids <SG_ID> \
  --backup-retention-period 7 \
  --no-publicly-accessible \
  --tags Key=app,Value=lkcm-icbot
```

After the instance is available:

```sql
-- connect via bastion or SSH tunnel
CREATE EXTENSION IF NOT EXISTS vector;
```

Construct the `DATABASE_URL`:

```
postgresql://lkcmicbot:<STRONG_PASSWORD>@<endpoint>:5432/lkcm_icbot?sslmode=require
```

Paste it into Vercel as the `DATABASE_URL` env var (encrypted). **Do not** commit it.

## 4. Path A — Vercel OIDC

### 4a. Get the team slug

In Vercel, look at your team URL: `vercel.com/<team-slug>`. That slug is what goes into the policy templates.

### 4b. Create the OIDC identity provider in AWS

```bash
aws iam create-open-id-connect-provider \
  --url https://oidc.vercel.com/<team-slug> \
  --client-id-list https://vercel.com/<team-slug> \
  --thumbprint-list <THUMBPRINT>
```

`<THUMBPRINT>` is the SHA-1 of Vercel's IdP cert. Fetch it with:

```bash
# one-liner: print the cert thumbprint Vercel currently uses
echo | openssl s_client -showcerts -servername oidc.vercel.com \
  -connect oidc.vercel.com:443 2>/dev/null \
  | openssl x509 -fingerprint -noout -sha1 \
  | tr -d ':' | awk -F= '{print tolower($2)}'
```

### 4c. Create the IAM role

Copy `iam/trust-policy-vercel-oidc.json` and replace every `__TEAM_SLUG__` with your actual Vercel team slug. Then:

```bash
aws iam create-role \
  --role-name lkcm-icbot-app \
  --assume-role-policy-document file:///tmp/trust-policy-vercel-oidc.json \
  --description "Assumed by Vercel at runtime via OIDC"

aws iam put-role-policy \
  --role-name lkcm-icbot-app \
  --policy-name lkcm-icbot-app-permissions \
  --policy-document file://infra/aws/iam/permissions-policy.json
```

The resulting role ARN is `arn:aws:iam::416689419695:role/lkcm-icbot-app`.

### 4d. Enable OIDC in Vercel and point it at the role

1. Vercel → Project `lkcm-ic-bot` → **Settings → Security → OIDC Federation** → toggle on.
2. Set the environment variable `AWS_ROLE_ARN=arn:aws:iam::416689419695:role/lkcm-icbot-app` for Production (and Preview if you want previews to have read-only test creds).
3. Set `AWS_REGION=us-east-1`, `AWS_WEB_IDENTITY_TOKEN_FILE=/var/run/secrets/vercel/oidc-token` (Vercel injects the token at this path).

The application already uses the AWS SDK default credential chain, which picks this up automatically.

## 5. Path B — IAM user (fallback)

See `iam/trust-policy-iam-user-fallback.md`. Skip §4 entirely if using this path.

## 6. Sanity checks

```bash
# From the Vercel deployment (or CTO laptop with assumed role):
aws sts get-caller-identity    # should show lkcm-icbot-app role
aws s3 ls s3://lkcm-icbot-docs-prod
aws bedrock-runtime converse \
  --model-id anthropic.claude-haiku-4-5 \
  --messages '[{"role":"user","content":[{"text":"ping"}]}]' --region us-east-1
```

If all three return successfully, cutover prerequisites are complete.

## 7. Hand back to me

Once done, send me:

- [ ] S3 bucket name (confirm `lkcm-icbot-docs-prod` or alternate)
- [ ] RDS endpoint (just the hostname — the password stays on your side)
- [ ] The role ARN (should be `arn:aws:iam::416689419695:role/lkcm-icbot-app`)
- [ ] Vercel team slug
- [ ] `sts get-caller-identity` output from a Vercel preview deployment

With those I can flip the app's config from Anthropic direct + local storage to Bedrock + S3 in a single PR.
