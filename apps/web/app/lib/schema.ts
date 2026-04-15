import { z } from "zod";
import { databaseEngineIdSchema } from "./database-engines";

// ─── Projects ────────────────────────────────────────────────────────────────

export const projectSchema = z.object({
  id: z.string().min(1, "Invalid id"),
  publicId: z.string().min(1).optional(),
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

export const serviceTypeSchema = z.enum(["docker-compose", "stack", "application", "databases"]);
export type ServiceType = z.infer<typeof serviceTypeSchema>;

export const traefikRouteRuleSchema = z.object({
  router: z.string().min(1).max(63),
  hosts: z.array(z.string()).min(1),
  pathPrefix: z.string().max(256).nullable().optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  /** When false, Traefik uses HTTP entrypoint only (no TLS). Default true. */
  https: z.boolean().optional(),
});
export type TraefikRouteRule = z.infer<typeof traefikRouteRuleSchema>;

export const serviceSchema = z.object({
  id: z.string().min(1),
  publicId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  projectPublicId: z.string().min(1).optional(),
  name: z.string().min(1, "Name is required").max(100),
  type: serviceTypeSchema,
  config: z.string().default(""),
  /** Passed to Docker on deploy (same format as a `.env` file). */
  env: z.string().default(""),
  description: z.string().optional().default(""),
  domains: z.array(z.string()).default([]),
  /** Traefik Swarm labels (Host / PathPrefix / routers). When set, overrides simple `domains` in generated compose. */
  traefikRoutes: z.array(traefikRouteRuleSchema).optional().default([]),
  createdAt: z.string(),
  isActive: z.boolean().default(true),
  /** ISO timestamp from server after a successful Docker deploy (`POST .../execute`). */
  lastDeployedAt: z.string().nullable().optional(),
  /** Docker project/stack name on the host (suffix may be added server-side). */
  appName: z.string().optional(),
  /** When set, Docker runs on this SSH host (see Remote servers settings). */
  remoteServerId: z.number().nullable().optional(),
  remoteServer: z
    .object({
      id: z.number(),
      name: z.string(),
      publicIpv4: z.string().nullable().optional(),
      /** JSON list from Domains page (deploy server). */
      domainsJson: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** Swarm application: optional host for `docker build` only (must be a build-role server). */
  buildRemoteServerId: z.number().nullable().optional(),
  buildRemoteServer: z
    .object({
      id: z.number(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  /** When true, build runs on the API host’s Docker even if deploy uses a remote host (requires registry image). */
  buildOnLocalDockerHost: z.boolean().optional().default(false),
  /** Swarm app: full image ref for build+push; stored in compose header `registry.pushImage`. */
  registryPushImage: z.string().nullable().optional(),
  /** Auto-generated traefik.me quick access URL (API-computed; requires public IPv4). */
  magicTraefikMeUrl: z.string().nullable().optional(),
  /** User-saved IPv4 embedded in Magic traefik.me hostname (optional). */
  magicTraefikMeIpv4: z.string().nullable().optional(),
});
export type Service = z.infer<typeof serviceSchema>;
const POSTGRES_IMAGE_REF = /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,127}$/;

const postgresCreateFieldsSchema = z.object({
  dbName: z.string().default(""),
  user: z.string().default(""),
  pass: z.string().default(""),
  rootUser: z.string().default(""),
  rootPass: z.string().default(""),
  password: z.string().default(""),
  volumePath: z.string().default(""),
  replicas: z.coerce.number().int().min(1).max(10).default(1),
  /** Empty = do not publish a host port */
  publishPort: z.string().default(""),
  /** Docker image ref; empty = server default */
  image: z.string().default(""),
});

export const createServiceSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(50),
    projectId: z.string().min(1),
    type: serviceTypeSchema,
    description: z.string().optional(),
    config: z.string().default(""),
    /** Full Docker network names (e.g. stack_key) to attach as external. */
    appExternalNetworkNames: z.array(z.string()).default([]),
    /** Compose network keys to create in this stack (overlay; Docker name `{stack}_{key}`). */
    appStackNetworkKeys: z.array(z.string()).default([]),
    databaseEngine: databaseEngineIdSchema.optional(),
    /** Required when type is databases (set at service creation). */
    postgres: postgresCreateFieldsSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "databases" && !data.databaseEngine) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a database engine.",
        path: ["databaseEngine"],
      });
    }
    if (data.type === "databases") {
      const p = data.postgres;
      const engine = data.databaseEngine;
      if (engine !== "redis" && !p?.dbName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Database name is required.",
          path: ["postgres", "dbName"],
        });
      }
      if ((engine === "postgres" || engine === "mysql" || engine === "mariadb") && !p?.user?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Database user is required.",
          path: ["postgres", "user"],
        });
      }
      if ((engine === "postgres" || engine === "mysql" || engine === "mariadb") && !p?.pass?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Database password is required.",
          path: ["postgres", "pass"],
        });
      }
      if ((engine === "mysql" || engine === "mariadb") && !p?.rootPass?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Root password is required.",
          path: ["postgres", "rootPass"],
        });
      }
      if (engine === "mongodb" && !p?.rootUser?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Root username is required.",
          path: ["postgres", "rootUser"],
        });
      }
      if (engine === "mongodb" && !p?.rootPass?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Root password is required.",
          path: ["postgres", "rootPass"],
        });
      }
      if (engine === "redis" && !p?.password?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Password is required.",
          path: ["postgres", "password"],
        });
      }
      const pp = p?.publishPort?.trim();
      if (pp) {
        const n = Number(pp);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Host port must be an integer from 1 to 65535 (or leave empty).",
            path: ["postgres", "publishPort"],
          });
        }
      }
      const im = p?.image?.trim();
      if (im && !POSTGRES_IMAGE_REF.test(im)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid image reference (use letters, digits, ._/:@- only).",
          path: ["postgres", "image"],
        });
      }
      const vp = p?.volumePath?.trim();
      if (vp && !/^\/[^\s]*$/.test(vp)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Volume path must start with / and contain no spaces.",
          path: ["postgres", "volumePath"],
        });
      }
    }

    if (data.type === "application") {
      const keys = (data.appStackNetworkKeys ?? []).map((k) => k.trim()).filter(Boolean);
      const seen = new Set<string>();
      for (const key of keys) {
        if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,62}$/.test(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Each network key must start with a letter and use letters, digits, dot, dash, underscore (max 63).",
            path: ["appStackNetworkKeys"],
          });
          return;
        }
        const low = key.toLowerCase();
        if (seen.has(low)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate stack network key.",
            path: ["appStackNetworkKeys"],
          });
          return;
        }
        seen.add(low);
      }
    }
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
