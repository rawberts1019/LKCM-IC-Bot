import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXTAUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().min(16, "NEXTAUTH_SECRET must be at least 16 chars"),

  AZURE_AD_CLIENT_ID: z.string().min(1),
  AZURE_AD_CLIENT_SECRET: z.string().min(1),
  AZURE_AD_TENANT_ID: z.string().min(1),

  ADMIN_EMAILS: z.string().default(""),

  DATABASE_URL: z.string().url(),

  LLM_PROVIDER: z.enum(["anthropic", "bedrock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  AWS_REGION: z.string().default("us-east-1"),
  AWS_BEDROCK_MODEL_ID: z.string().default("anthropic.claude-sonnet-4-6"),

  STORAGE_PROVIDER: z.enum(["vercel-blob", "s3"]).default("vercel-blob"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),

  CONFIDENCE_AUTO_SEND_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75)
});

function parseEnv() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv();

export const adminEmails = env.ADMIN_EMAILS.split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
