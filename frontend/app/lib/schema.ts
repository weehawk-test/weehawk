import { z } from "zod";

// ─── Webhooks ────────────────────────────────────────────────────────────────

export const webhookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(100),
  script: z.string().min(1, "Script is required"),
  description: z.string().optional().default(""),
  createdAt: z.string().datetime(),
  isActive: z.boolean().default(true),
});
export type Webhook = z.infer<typeof webhookSchema>;
export const createWebhookSchema = webhookSchema.omit({ id: true, createdAt: true, isActive: true });
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export const updateWebhookSchema = webhookSchema.partial();
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

// ─── Projects ────────────────────────────────────────────────────────────────

export const projectSchema = z.object({
  id: z.string().min(1, "Invalid id"),
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().optional().default(""),
  createdAt: z.string(),
  isActive: z.boolean().default(true),
  /** Set when listing from API (nested `services` length). */
  serviceCount: z.number().int().nonnegative().optional(),
});
export type Project = z.infer<typeof projectSchema>;
export const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().default(""),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// ─── Services ────────────────────────────────────────────────────────────────

export const serviceTypeSchema = z.enum(["docker-compose", "stack"]);
export type ServiceType = z.infer<typeof serviceTypeSchema>;

export const serviceSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1, "Name is required").max(100),
  type: serviceTypeSchema,
  config: z.string().default(""),
  /** Passed to Docker on deploy (same format as a `.env` file). */
  env: z.string().default(""),
  description: z.string().optional().default(""),
  domains: z.array(z.string()).default([]),
  createdAt: z.string(),
  isActive: z.boolean().default(true),
  /** ISO timestamp from server after a successful Docker deploy (`POST .../execute`). */
  lastDeployedAt: z.string().nullable().optional(),
  /** Docker project/stack name on the host (suffix may be added server-side). */
  appName: z.string().optional(),
});
export type Service = z.infer<typeof serviceSchema>;
export const createServiceSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  projectId: z.string().min(1),
  type: serviceTypeSchema,
  description: z.string().optional(),
  config: z.string().default(""),
});
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

// ─── Deploy Logs ─────────────────────────────────────────────────────────────

export const deployStatusSchema = z.enum(["pending", "running", "success", "failed"]);
export type DeployStatus = z.infer<typeof deployStatusSchema>;

export const deployLogSchema = z.object({
  id: z.string().uuid(),
  /** Matches backend numeric service id as string (e.g. "12"). */
  serviceId: z.string().min(1),
  status: deployStatusSchema,
  trigger: z.string().default("manual"),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable().default(null),
  /** Verbatim CLI output (preferred for display). Legacy logs use `lines` only. */
  rawOutput: z.string().optional(),
  lines: z.array(
    z.object({
      ts: z.string(),
      level: z.enum(["info", "warn", "error", "success"]),
      msg: z.string(),
    })
  ).default([]),
});
export type DeployLog = z.infer<typeof deployLogSchema>;

// ─── Docker Secrets (Swarm; values never returned by API) ────────────────────

export const dockerSecretListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type DockerSecretListItem = z.infer<typeof dockerSecretListItemSchema>;
export type DockerSecret = DockerSecretListItem;

export const createDockerSecretSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(255)
    .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes, and underscores only"),
  value: z.string().min(1, "Value is required"),
});
export type CreateDockerSecretInput = z.infer<typeof createDockerSecretSchema>;

export const replaceDockerSecretSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1, "New value is required"),
});
export type ReplaceDockerSecretInput = z.infer<typeof replaceDockerSecretSchema>;
