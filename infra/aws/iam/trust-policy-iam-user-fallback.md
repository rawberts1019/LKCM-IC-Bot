# IAM user fallback (only if Vercel OIDC setup is a blocker)

Vercel OIDC is the preferred path — no long-lived credentials ever leave AWS. If it's blocking the timeline, create a **scoped IAM user** instead and rotate the keys before the pilot.

## Create the user

```
Name:       lkcm-icbot-app
Access:     Programmatic only
Policies:   (inline) the permissions-policy.json in this directory
Tags:       env=prod, owner=cto@lkcm.com
```

## Generate an access key, store in Vercel

1. IAM → Users → `lkcm-icbot-app` → **Security credentials** → Create access key.
2. Use case: "Third-party service" → "Vercel deployment".
3. In Vercel, Project **Settings → Environment Variables**, add (encrypted):
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_REGION=us-east-1`

## Rotation

Set a calendar reminder for **30 days** to rotate. Vercel env supports hot-swapping keys — generate a new one, update the env var, mark the old key inactive, then delete after 24 hours.

## Migration to OIDC

When ready, follow the Vercel OIDC steps in `../README.md`. Once the role works end to end, delete this user.
