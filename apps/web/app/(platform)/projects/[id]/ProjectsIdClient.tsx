"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Trash2, ChevronRight, ChevronDown, Clock, Container, Layers, Database, Server, Lock, LockOpen, PackageOpen, FolderKanban, Loader2, Search, Eye, EyeOff, X, LayoutTemplate } from "lucide-react";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useDockerListUrl } from "@/hooks/use-docker-list-url";
import { projectQueryKey, useProject } from "@/hooks/use-projects";
import { useServicesPage, useCreateService, useDeleteService, useProjectRuntimeSnapshot } from "@/hooks/use-services";
import { ListPagination } from "@/components/docker/ListPagination";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createServiceSchema, type CreateServiceInput, type Project } from "@/lib/schema";
import {
  applyDatabaseApi,
  serviceQueryKeyId,
  SERVICES_PAGE_SIZE,
  type ServicesPageResponse,
} from "@/lib/services-api";
import { invalidateServiceScopedQueries } from "@/lib/invalidate-service-queries";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { DatabaseEnginePicker } from "@/components/database-engine-picker";
import {
  databaseLogoBlendClass,
  databaseLogoSizeClass,
  getDatabaseEngineById,
  parseDatabaseEngineFromConfig,
  POSTGRES_DOCKER_IMAGE,
  defaultDatabaseImage,
  defaultDatabaseVolumePath,
} from "@/lib/database-engines";
import { markPendingDeletion, reconcileAndFilterPendingDeletions } from "@/lib/pending-deletions";
import { CoolifyTemplatePicker } from "@/components/coolify-template-picker";
import {
  coolifyTemplateDisplayName,
  coolifyTemplateLogoUrl,
  decodeCoolifyComposeBase64,
  parseCoolifyTemplateIdFromConfig,
  type CoolifyServiceTemplate,
} from "@/lib/coolify-templates";
import { useCoolifyTemplates } from "@/hooks/use-coolify-templates";

const SERVICE_TYPE_CONFIG = {
  "docker-compose": {
    label: "Docker Compose",
    color: "bg-zinc-500/10 text-zinc-700 border-zinc-400/40 dark:text-zinc-300 dark:border-zinc-500/20",
    icon: Container,
    placeholder: `version: '3.8'\nservices:\n  app:\n    image: nginx:latest\n    ports:\n      - "80:80"`,
  },
  stack: {
    label: "Stack",
    color: "bg-muted/70 text-zinc-800 border-zinc-300/60 dark:bg-white/5 dark:text-zinc-200 dark:border-white/10",
    icon: Layers,
    placeholder: `version: '3.8'\nservices:\n  app:\n    image: nginx:latest\n    deploy:\n      replicas: 2`,
  },
  application: {
    label: "Application",
    color: "bg-violet-500/10 text-violet-800 border-violet-400/45 dark:text-violet-200 dark:border-violet-500/25",
    icon: PackageOpen,
    placeholder: "",
  },
  databases: {
    label: "Databases",
    color: "bg-sky-500/10 text-sky-800 border-sky-400/45 dark:text-sky-200 dark:border-sky-500/25",
    icon: Database,
    placeholder: "",
  },
  template: {
    label: "Template",
    color: "bg-amber-500/10 text-amber-900 border-amber-400/45 dark:text-amber-200 dark:border-amber-500/25",
    icon: LayoutTemplate,
    placeholder: "",
  },
} as const;
type DockerAdvancedMode = "docker-compose" | "stack";

function DockerModePicker({
  open,
  selectedMode,
  onSelect,
  onCancel,
}: {
  open: boolean;
  selectedMode: DockerAdvancedMode;
  onSelect: (mode: DockerAdvancedMode) => void;
  onCancel: () => void;
}) {
  const options: Array<{
    id: DockerAdvancedMode;
    title: string;
    description: string;
    icon: typeof Container;
  }> = [
    {
      id: "docker-compose",
      title: "Docker Compose",
      description: "Single-host compose workflow with docker compose.",
      icon: Container,
    },
    {
      id: "stack",
      title: "Docker Stack",
      description: "Swarm stack workflow with docker stack deploy.",
      icon: Layers,
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="docker-mode-picker-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md dark:bg-black/70"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 pb-4 pt-6">
              <div>
                <h2 id="docker-mode-picker-title" className="text-xl font-semibold tracking-tight text-foreground">
                  Choose Docker mode
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Select whether this advanced Docker service uses Compose or Swarm Stack.
                </p>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid gap-3 p-6 sm:grid-cols-2">
              {options.map((opt) => {
                const Icon = opt.icon;
                const active = selectedMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onSelect(opt.id)}
                    className={`flex min-h-[8rem] w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? "border-primary/45 bg-primary/10 ring-1 ring-primary/20"
                        : "border-border bg-muted/50 hover:border-primary/30 hover:bg-muted"
                    }`}
                  >
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">{opt.title}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{opt.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function dbPortByEngine(engine?: CreateServiceInput["databaseEngine"]): number {
  if (engine === "postgres") return 5432;
  if (engine === "mysql" || engine === "mariadb") return 3306;
  if (engine === "mongodb") return 27017;
  if (engine === "redis") return 6379;
  return 5432;
}

/** Dot + label under the type badge: Running / Stopped. */
function ServiceRuntimeStatus({
  running,
  loading,
  errored,
}: {
  running?: boolean;
  loading?: boolean;
  errored?: boolean;
}) {
  if (loading) {
    return (
      <div
        className="flex w-full items-center justify-center gap-1.5 text-[10px] text-muted-foreground"
        title="Checking runtime status..."
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40 animate-pulse" aria-hidden />
        <span className="font-medium tabular-nums">Checking...</span>
      </div>
    );
  }
  if (errored) {
    return (
      <div
        className="flex w-full items-center justify-center gap-1.5 text-[10px] text-muted-foreground"
        title="Could not load runtime"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50 ring-1 ring-border" aria-hidden />
        <span className="font-medium">—</span>
      </div>
    );
  }
  const isRunning = running === true;
  return (
    <div
      className={`flex w-full items-center justify-center gap-1.5 text-[10px] font-medium ${
        isRunning ? "text-emerald-700 dark:text-emerald-400/95" : "text-red-700 dark:text-red-400/95"
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          isRunning
            ? "bg-emerald-600 shadow-[0_0_5px_rgba(5,150,105,0.45)] dark:bg-emerald-500 dark:shadow-[0_0_6px_rgba(16,185,129,0.55)]"
            : "bg-red-600 shadow-[0_0_4px_rgba(220,38,38,0.4)] dark:bg-red-500 dark:shadow-[0_0_4px_rgba(239,68,68,0.35)]"
        }`}
        aria-hidden
      />
      <span>{isRunning ? "Running" : "Stopped"}</span>
    </div>
  );
}

function CreateServiceModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const create = useCreateService();
  const { toast } = useToast();
  const [dbPickerOpen, setDbPickerOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [dockerModePickerOpen, setDockerModePickerOpen] = useState(false);
  const [imageUnlocked, setImageUnlocked] = useState(false);
  const [showDbUserPass, setShowDbUserPass] = useState(false);
  const [showDbRootPass, setShowDbRootPass] = useState(false);
  const [showDbRedisPass, setShowDbRedisPass] = useState(false);
  const { register, handleSubmit, formState: { errors }, watch, setValue, getValues } = useForm<CreateServiceInput>({
    resolver: zodResolver(createServiceSchema) as Resolver<CreateServiceInput>,
    defaultValues: {
      name: "",
      projectId,
      type: "application",
      config: "",
      description: "",
      databaseEngine: undefined,
      coolifyTemplateId: undefined,
      coolifyTemplatePort: undefined,
      postgres: {
        dbName: "",
        user: "",
        pass: "",
        rootUser: "",
        rootPass: "",
        password: "",
        volumePath: "",
        replicas: 1,
        publishPort: "",
        image: POSTGRES_DOCKER_IMAGE,
      },
    },
  });

  const type = watch("type");
  const databaseEngine = watch("databaseEngine");
  const coolifyTemplateId = watch("coolifyTemplateId");
  const isDockerAdvancedType = type === "docker-compose" || type === "stack";

  useEffect(() => {
    if (type !== "databases") {
      setValue("databaseEngine", undefined);
      setImageUnlocked(false);
    }
  }, [type, setValue]);

  useEffect(() => {
    if (type !== "template") {
      setValue("coolifyTemplateId", undefined);
      setValue("coolifyTemplatePort", undefined);
      if (type !== "docker-compose" && type !== "stack") {
        setValue("config", "");
      }
    }
  }, [type, setValue]);

  useEffect(() => {
    if (type !== "databases") {
      setValue("postgres", {
        dbName: "",
        user: "",
        pass: "",
        rootUser: "",
        rootPass: "",
        password: "",
        volumePath: "",
        replicas: 1,
        publishPort: "",
        image: POSTGRES_DOCKER_IMAGE,
      });
    }
  }, [type, databaseEngine, setValue]);

  useEffect(() => {
    if (type === "databases" && databaseEngine) {
      setValue("postgres.image", defaultDatabaseImage(databaseEngine));
      setValue("postgres.volumePath", defaultDatabaseVolumePath(databaseEngine));
      setImageUnlocked(false);
    }
  }, [type, databaseEngine, setValue]);

  useEffect(() => {
    setShowDbUserPass(false);
    setShowDbRootPass(false);
    setShowDbRedisPass(false);
  }, [databaseEngine]);

  useEffect(() => {
    if (type === "databases" && !databaseEngine) {
      setDbPickerOpen(true);
    }
  }, [type, databaseEngine]);

  useEffect(() => {
    if (type === "template" && !coolifyTemplateId) {
      setTemplatePickerOpen(true);
    }
  }, [type, coolifyTemplateId]);

  const applyCoolifyTemplate = (tpl: CoolifyServiceTemplate) => {
    const yaml = decodeCoolifyComposeBase64(tpl.compose);
    const svcName =
      getValues("name")?.trim() || tpl.id.replace(/[^a-z0-9-]/gi, "-").slice(0, 50);
    setValue("coolifyTemplateId", tpl.id, { shouldDirty: true, shouldValidate: true });
    setValue("coolifyTemplatePort", tpl.port ?? "", { shouldDirty: true });
    setValue("config", yaml, { shouldDirty: true });
    if (!getValues("name")?.trim()) {
      setValue("name", svcName, { shouldDirty: true });
    }
    if (!getValues("description")?.trim()) {
      setValue("description", tpl.slogan, { shouldDirty: true });
    }
    setTemplatePickerOpen(false);
  };

  const onSubmit = async (data: CreateServiceInput) => {
    try {
      const created = await create.mutateAsync(data);
      if (data.type === "databases" && data.databaseEngine && data.postgres) {
        const pp = data.postgres.publishPort?.trim();
        const img = data.postgres.image?.trim();
        await applyDatabaseApi(created.id, data.databaseEngine, {
          dbName: data.postgres.dbName.trim(),
          user: data.postgres.user.trim() || undefined,
          pass: data.postgres.pass || undefined,
          rootUser: data.postgres.rootUser.trim() || undefined,
          rootPass: data.postgres.rootPass || undefined,
          password: data.postgres.password || undefined,
          volumePath: data.postgres.volumePath.trim() || undefined,
          replicas: data.postgres.replicas ?? 1,
          ...(pp ? { publishPort: parseInt(pp, 10) } : {}),
          ...(img ? { image: img } : {}),
        });
        await invalidateServiceScopedQueries(qc, serviceQueryKeyId(created), user?.userId ?? "none");
      }
      toast({
        title: "Service Created",
        description:
          data.type === "databases" && data.databaseEngine
            ? "Database stack and credentials are saved. Deploy from the service page when ready."
            : data.type === "template"
              ? "Template compose is ready. Review env vars and deploy from the service page."
              : "Your new service is ready.",
      });
      onCreated?.();
      onClose();
    } catch (e: unknown) {
      toast({
        title: "Could not create service",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const closeModal = () => {
    if (create.isPending) return;
    onClose();
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[80] overflow-y-auto modal-scrim flex items-center justify-center p-4"
        onClick={closeModal}
        role="presentation"
      >
      <DatabaseEnginePicker
        open={dbPickerOpen}
        selectedId={databaseEngine}
        onSelect={(id) => {
          setValue("databaseEngine", id);
          setDbPickerOpen(false);
        }}
        onCancel={() => {
          setDbPickerOpen(false);
          if (!getValues("databaseEngine")) {
            setValue("type", "application");
          }
        }}
      />
      <DockerModePicker
        open={dockerModePickerOpen}
        selectedMode={type === "stack" ? "stack" : "docker-compose"}
        onSelect={(mode) => {
          setValue("type", mode, { shouldDirty: true });
          setDockerModePickerOpen(false);
        }}
        onCancel={() => {
          setDockerModePickerOpen(false);
        }}
      />
      <CoolifyTemplatePicker
        open={templatePickerOpen}
        selectedId={coolifyTemplateId}
        onSelect={applyCoolifyTemplate}
        onCancel={() => {
          setTemplatePickerOpen(false);
          if (!getValues("coolifyTemplateId")) {
            setValue("type", "application");
          }
        }}
      />
      <div
        className="glass-panel rounded-2xl p-8 w-full max-w-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 blur-[60px] pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between gap-3 mb-1">
          <h2 className="text-2xl font-bold min-w-0">New Service</h2>
          <button
            type="button"
            disabled={create.isPending}
            onClick={closeModal}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-muted-foreground text-sm mb-6 relative z-10">Add a service to this project.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 relative z-10">
          <input type="hidden" {...register("projectId")} />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Service Name</label>
              <input {...register("name")} className="input-field" placeholder="e.g., web-server" />
              {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Type</label>
              <div className="relative">
                <select
                  value={isDockerAdvancedType ? "docker-advanced" : type}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "docker-advanced") {
                      if (!isDockerAdvancedType) {
                        setValue("type", "docker-compose", { shouldDirty: true });
                      }
                      setDockerModePickerOpen(true);
                      return;
                    }
                    if (
                      next === "application" ||
                      next === "databases" ||
                      next === "template"
                    ) {
                      setValue("type", next, { shouldDirty: true });
                    }
                  }}
                  className="input-field w-full appearance-none pr-10"
                  aria-label="Service type"
                >
                  <option value="application" className="bg-card">Application</option>
                  <option value="databases" className="bg-card">Databases</option>
                  <option value="template" className="bg-card">Template</option>
                  <option value="docker-advanced" className="bg-card">Docker (Advanced)</option>
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
              {isDockerAdvancedType && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Mode:</span>
                  <span className="text-xs font-medium text-zinc-700 border border-zinc-400/50 rounded-full px-2.5 py-0.5 bg-zinc-200/60 dark:text-zinc-300 dark:border-zinc-500/30 dark:bg-zinc-500/10">
                    {type === "stack" ? "Docker Stack" : "Docker Compose"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDockerModePickerOpen(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
              )}
              {type === "databases" && databaseEngine && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Engine:</span>
                  <span className="text-xs font-medium text-sky-300 border border-sky-500/30 rounded-full px-2.5 py-0.5 bg-sky-500/10">
                    {getDatabaseEngineById(databaseEngine)?.name ?? databaseEngine}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDbPickerOpen(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
              )}
              {type === "template" && coolifyTemplateId && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Stack:</span>
                  <span className="text-xs font-medium text-amber-800 border border-amber-500/30 rounded-full px-2.5 py-0.5 bg-amber-500/10 dark:text-amber-200">
                    {coolifyTemplateDisplayName(coolifyTemplateId)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTemplatePickerOpen(true)}
                    className="text-xs text-primary hover:underline"
                  >
                    Change
                  </button>
                </div>
              )}
              {errors.databaseEngine && (
                <p className="text-destructive text-xs mt-1">{errors.databaseEngine.message}</p>
              )}
              {errors.coolifyTemplateId && (
                <p className="text-destructive text-xs mt-1">{errors.coolifyTemplateId.message}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input {...register("description")} className="input-field" placeholder="Short description of this service" />
          </div>

          {type === "template" && coolifyTemplateId && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                {coolifyTemplateDisplayName(coolifyTemplateId)}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Compose is loaded from Coolify&apos;s catalog. Set environment variables on the service page before
                deploy.
              </p>
            </div>
          )}

          {type === "databases" && databaseEngine && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-sky-800 dark:text-sky-200 mb-0.5">
                  {getDatabaseEngineById(databaseEngine)?.name ?? "Database"}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Credentials are saved once based on the selected engine. Stack YAML uses environment placeholders.
                </p>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground block">Docker image</label>
                  <div className="relative">
                    <input
                      {...register("postgres.image")}
                      readOnly={!imageUnlocked}
                      title={!imageUnlocked ? "Unlock to edit image" : undefined}
                      className={`input-field w-full font-mono text-sm pr-10 ${!imageUnlocked ? "bg-zinc-950/80 !text-zinc-500 border-white/10 cursor-not-allowed" : ""}`}
                      placeholder={defaultDatabaseImage(databaseEngine)}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setImageUnlocked((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10"
                      aria-label={imageUnlocked ? "Lock image field" : "Unlock image field"}
                    >
                      {imageUnlocked ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                    </button>
                  </div>
                  {errors.postgres?.image && (
                    <p className="text-destructive text-xs">{errors.postgres.image.message}</p>
                  )}
                  {imageUnlocked && (
                    <p className="text-[11px] text-amber-500/90 leading-snug rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2">
                      Warning: Data storage path can differ between image versions. Verify the path and update the volume mount to match the selected version.
                    </p>
                  )}
                  {imageUnlocked && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground block">Volume path</label>
                      <input
                        {...register("postgres.volumePath")}
                        className="input-field w-full font-mono text-sm"
                        placeholder={`default: ${defaultDatabaseVolumePath(databaseEngine)}`}
                        autoComplete="off"
                      />
                      {errors.postgres?.volumePath && (
                        <p className="text-destructive text-xs">{errors.postgres.volumePath.message}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {databaseEngine !== "redis" && (
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Database name</label>
                  <input
                    {...register("postgres.dbName")}
                    className="input-field w-full font-mono text-sm"
                    placeholder="myapp-db"
                    autoComplete="off"
                  />
                  {errors.postgres?.dbName && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.dbName.message}</p>
                  )}
                </div>
                )}
                {(databaseEngine === "postgres" || databaseEngine === "mysql" || databaseEngine === "mariadb") && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">User</label>
                  <input
                    {...register("postgres.user")}
                    className="input-field w-full font-mono text-sm"
                    placeholder="appuser"
                    autoComplete="off"
                  />
                  {errors.postgres?.user && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.user.message}</p>
                  )}
                </div>
                )}
                {(databaseEngine === "postgres" || databaseEngine === "mysql" || databaseEngine === "mariadb") && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showDbUserPass ? "text" : "password"}
                      {...register("postgres.pass")}
                      className="input-field w-full font-mono text-sm pr-10"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDbUserPass((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10"
                      aria-label={showDbUserPass ? "Hide password" : "Show password"}
                      title={showDbUserPass ? "Hide" : "Show"}
                    >
                      {showDbUserPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.postgres?.pass && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.pass.message}</p>
                  )}
                </div>
                )}
                {(databaseEngine === "mysql" || databaseEngine === "mariadb") && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root Password</label>
                  <div className="relative">
                    <input
                      type={showDbRootPass ? "text" : "password"}
                      {...register("postgres.rootPass")}
                      className="input-field w-full font-mono text-sm pr-10"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDbRootPass((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10"
                      aria-label={showDbRootPass ? "Hide root password" : "Show root password"}
                      title={showDbRootPass ? "Hide" : "Show"}
                    >
                      {showDbRootPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.postgres?.rootPass && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.rootPass.message}</p>
                  )}
                </div>
                )}
                {databaseEngine === "mongodb" && (
                <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root Username</label>
                  <input
                    {...register("postgres.rootUser")}
                    className="input-field w-full font-mono text-sm"
                    placeholder="root"
                    autoComplete="off"
                  />
                  {errors.postgres?.rootUser && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.rootUser.message}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root Password</label>
                  <div className="relative">
                    <input
                      type={showDbRootPass ? "text" : "password"}
                      {...register("postgres.rootPass")}
                      className="input-field w-full font-mono text-sm pr-10"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDbRootPass((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10"
                      aria-label={showDbRootPass ? "Hide root password" : "Show root password"}
                      title={showDbRootPass ? "Hide" : "Show"}
                    >
                      {showDbRootPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.postgres?.rootPass && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.rootPass.message}</p>
                  )}
                </div>
                </>
                )}
                {databaseEngine === "redis" && (
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password</label>
                  <div className="relative">
                    <input
                      type={showDbRedisPass ? "text" : "password"}
                      {...register("postgres.password")}
                      className="input-field w-full font-mono text-sm pr-10"
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowDbRedisPass((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10"
                      aria-label={showDbRedisPass ? "Hide password" : "Show password"}
                      title={showDbRedisPass ? "Hide" : "Show"}
                    >
                      {showDbRedisPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.postgres?.password && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.password.message}</p>
                  )}
                </div>
                )}
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Replicas (1–10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    {...register("postgres.replicas", { valueAsNumber: true })}
                    className="input-field w-full max-w-[8rem] font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    Host port <span className="text-muted-foreground/80 font-normal">(optional)</span>
                  </label>
                  <input
                    {...register("postgres.publishPort")}
                    className="input-field w-full max-w-[8rem] font-mono text-sm"
                    placeholder={`e.g. ${dbPortByEngine(databaseEngine)}`}
                    inputMode="numeric"
                    autoComplete="off"
                  />
                  {errors.postgres?.publishPort && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.publishPort.message}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
                    Leave empty so this database is not published on the host (internal / overlay only).
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={create.isPending} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={create.isPending} className="btn-primary flex items-center gap-2">
              {create.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> Creating...
                </>
              ) : (
                "Create Service"
              )}
            </button>
          </div>
        </form>
      </div>
      </div>
    </>,
    document.body,
  );
}

function serviceDetailHref(
  projectRouteId: string,
  serviceKey: string,
  _activeOrgPublicId?: string,
) {
  return `/projects/${projectRouteId}/services/${serviceKey}`;
}

export default function ProjectsIdClient({
  projectId,
  initialProject,
  initialServicesPage,
  initialProjectError,
  urlPage,
  urlQ,
  activeOrgPublicId,
}: {
  projectId: string;
  initialProject?: Project | null;
  initialServicesPage?: ServicesPageResponse;
  initialProjectError?: string | null;
  urlPage: number;
  urlQ: string;
  activeOrgPublicId?: string;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  /** After mount, safe to apply client-only pending-deletion filter (matches SSR list for hydration). */
  const [servicesListClientReady, setServicesListClientReady] = useState(false);
  useEffect(() => {
    setServicesListClientReady(true);
  }, []);
  const { page, q, localQ, setLocalQ, setPage } = useDockerListUrl(urlPage, urlQ);

  const { data: project, isLoading: projectLoading } = useProject(projectId, {
    initialData: initialProject ?? undefined,
    skipClientFetch: Boolean(initialProject),
    activeOrgPublicId: activeOrgPublicId ?? initialProject?.organizationPublicId,
  });

  useEffect(() => {
    if (initialProject) {
      qc.setQueryData(
        projectQueryKey(user?.userId, projectId, activeOrgPublicId ?? initialProject.organizationPublicId),
        initialProject,
      );
    }
  }, [initialProject, projectId, qc, user?.userId, activeOrgPublicId]);

  useEffect(() => {
    if (initialServicesPage === undefined) return;
    const trimmed = urlQ.trim();
    qc.setQueryData(
      ["services", "list", user?.userId ?? "none", projectId, urlPage, trimmed],
      initialServicesPage,
    );
  }, [initialServicesPage, projectId, urlPage, urlQ, qc, user?.userId]);

  const {
    data: servicesPageData,
    isLoading: servicesLoading,
    isError: servicesError,
    error: servicesErr,
    refetch: refetchServices,
  } = useServicesPage(projectId, page, q, urlPage, urlQ, initialServicesPage);

  const items = useMemo(() => {
    const raw = servicesPageData?.data ?? [];
    if (!servicesListClientReady) return raw;
    return reconcileAndFilterPendingDeletions("services", raw, (item) => [item.id, item.publicId]);
  }, [servicesListClientReady, servicesPageData?.data]);
  const total = servicesPageData?.total ?? 0;
  const runtimeSnapshot = useProjectRuntimeSnapshot(
    projectId,
    items.length > 0,
  );
  const runtimeByServiceId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of runtimeSnapshot.data?.data ?? []) {
      map.set(String(row.servicePublicId), row.running === true);
    }
    return map;
  }, [runtimeSnapshot.data?.data]);
  const hasTemplateServices = items.some((s) => s.type === "template");
  const { data: coolifyTemplates = [] } = useCoolifyTemplates(hasTemplateServices);
  const coolifyTemplateById = useMemo(
    () => new Map(coolifyTemplates.map((t) => [t.id, t])),
    [coolifyTemplates],
  );
  const limit = servicesPageData?.limit ?? SERVICES_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total > 0 ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);

  const deleteService = useDeleteService();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const serviceKeys = useMemo(() => items.map((s) => serviceQueryKeyId(s)), [items]);
  const servicesBulk = useBulkSelection(serviceKeys);

  useEffect(() => {
    if (total > 0 && items.length === 0 && page > 1) {
      setPage(1);
    }
  }, [total, items.length, page, setPage]);

  useEffect(() => {
    if (!projectLoading && !project) {
      router.replace("/resource-not-found");
    }
  }, [projectLoading, project, router]);

  const handleDeleteService = async (serviceId: string, name: string) => {
    const ok = await confirm({
      title: "Delete this service?",
      description: `“${name}” will be removed from this project. This may stop related workloads on the server.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    const target = items.find((item) => serviceQueryKeyId(item) === serviceId);
    markPendingDeletion("services", serviceId, target?.id, target?.publicId);

    deleteService.mutate(serviceId, {
      onSuccess: () => {
        toast({ title: "Service Deleted", description: `"${name}" removed.` });
      },
      onError: (e: Error) =>
        toast({ title: "Could not delete service", description: e.message, variant: "destructive" }),
    });
  };

  const handleBulkDeleteServices = async () => {
    const ids = servicesBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected services?",
      description: `Delete ${ids.length} service(s)? Related workloads on the server may be stopped.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    setIsBulkDeleting(true);
    const selectedRows = items.filter((item) => ids.includes(serviceQueryKeyId(item)));
    markPendingDeletion(
      "services",
      ...ids,
      ...selectedRows.flatMap((item) => [item.id, item.publicId]),
    );
    toast({
      title: "Services deleted",
      description: `${ids.length} service(s) removed.`,
    });
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteService.mutateAsync(id)));
      const removed = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - removed;
      servicesBulk.clear();
      if (fail > 0) {
        toast({
          title: "Some services could not be deleted",
          description: `${removed} removed, ${fail} failed.`,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "Could not delete selected services",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const projectsHref = "/projects";

  if (!project) {
    if (projectLoading) return null;
    return (
      <>
        <div className="text-center py-20">
          <p className="text-muted-foreground">
            {initialProjectError ? initialProjectError : "Project not found."}
          </p>
          <Link href={projectsHref} className="btn-secondary mt-4 inline-flex items-center gap-2">
            <FolderKanban className="w-4 h-4" /> Projects
          </Link>
        </div>
      </>
    );
  }

  const projectRouteId = project.publicId ?? projectId;
  const projectNumericId = project.id;

  return (
    <>
      {showCreate ? (
        <CreateServiceModal
          projectId={projectNumericId}
          onClose={() => setShowCreate(false)}
          onCreated={() => router.refresh()}
        />
      ) : null}

      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
        <Link href={projectsHref}>
          <span className="hover:text-foreground cursor-pointer flex items-center gap-1 transition-colors">
            <FolderKanban className="w-3.5 h-3.5" /> Projects
          </span>
        </Link>
        <span className="text-muted-foreground/35">/</span>
        <span className="text-foreground font-medium">{project.name}</span>
      </div>

      {/* Project Header */}
      <div className="glass-panel rounded-2xl p-6 mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/5 blur-[60px] pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Server className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{project.name}</h1>
              {project.description && (
                <p className="text-muted-foreground text-sm mt-1">{project.description}</p>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                Created {format(new Date(project.createdAt), "MMM d, yyyy")}
              </div>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" /> Add Service
          </button>
        </div>
      </div>

      {/* Services */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          Services <span className="text-muted-foreground font-normal text-base ml-1">({total})</span>
        </h2>

        <div className="mb-8">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search services..."
              value={localQ}
              onChange={(e) => setLocalQ(e.target.value)}
              className="input-field !pl-10 w-full bg-card/50"
            />
          </div>
          {items.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <DockerBulkCheckbox
                  checked={
                    servicesBulk.allSelected ? true : servicesBulk.someSelected ? "indeterminate" : false
                  }
                  onCheckedChange={() => servicesBulk.toggleAllFiltered()}
                  aria-label="Select all services on this page"
                />
                <span className="text-sm text-muted-foreground">
                  Select all on this page ({items.length})
                </span>
              </div>
              {servicesBulk.selectedInFiltered.length > 0 && (
                <button
                  type="button"
                  onClick={handleBulkDeleteServices}
                  disabled={isBulkDeleting || deleteService.isPending}
                  className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
                >
                  {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete ({servicesBulk.selectedInFiltered.length})
                </button>
              )}
            </div>
          )}
        </div>

        {servicesError && (
          <div className="glass-panel rounded-xl p-4 mb-4 border border-destructive/30 text-sm">
            <p className="font-medium text-destructive">Could not load services</p>
            <p className="text-muted-foreground mt-1">{servicesErr instanceof Error ? servicesErr.message : "Unknown error"}</p>
            <button
              type="button"
              onClick={() => {
                void refetchServices();
                router.refresh();
              }}
              className="btn-secondary mt-3 text-xs"
            >
              Retry
            </button>
          </div>
        )}

        {servicesLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="glass-panel p-10 rounded-2xl flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
              <Container className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-bold mb-2">{q.trim() ? "No matching services" : "No services yet"}</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-sm">
              {q.trim()
                ? "Try a different search."
                : "Add your first service (Application, Databases, Template, or Docker Advanced) to this project."}
            </p>
            {!q.trim() && (
              <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Service
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((service) => {
                const typeConf = SERVICE_TYPE_CONFIG[service.type as keyof typeof SERVICE_TYPE_CONFIG] ??
                  SERVICE_TYPE_CONFIG["docker-compose"];
                const Icon = typeConf.icon;
                const dbEngineId =
                  service.type === "databases" ? parseDatabaseEngineFromConfig(service.config) : undefined;
                const dbLogo = dbEngineId ? getDatabaseEngineById(dbEngineId)?.logoSrc : undefined;
                const templateId =
                  service.type === "template" ? parseCoolifyTemplateIdFromConfig(service.config) : undefined;
                const templateEntry = templateId ? coolifyTemplateById.get(templateId) : undefined;
                const tplLogo =
                  templateId && templateEntry
                    ? coolifyTemplateLogoUrl(templateEntry.logo, templateId)
                    : undefined;

                return (
                  <div
                    key={service.id}
                    className="group relative flex flex-col rounded-xl border border-white/5 bg-gradient-to-b from-white/[0.06] to-transparent p-3 shadow-sm hover:border-primary/20 hover:shadow-[0_6px_28px_-10px_rgba(0,0,0,0.35)] md:aspect-square max-md:min-h-[180px]"
                  >
                    <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

                    <div className="relative flex min-h-0 flex-1 flex-col">
                      <div className="mb-2 flex items-start justify-between gap-1.5">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg overflow-hidden ${
                            service.isActive
                              ? dbLogo || tplLogo
                                ? dbLogo
                                  ? "border border-sky-500/25 bg-transparent p-0.5"
                                  : "border border-amber-500/25 bg-transparent p-0.5"
                                : `border ${typeConf.color}`
                              : "border border-border bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {dbLogo && dbEngineId ? (
                            <Image
                              src={dbLogo}
                              alt=""
                              width={28}
                              height={28}
                              className={`object-contain h-auto w-auto max-h-7 ${databaseLogoBlendClass(dbEngineId)} ${databaseLogoSizeClass(dbEngineId)}`}
                              sizes="36px"
                            />
                          ) : tplLogo ? (
                            <Image
                              src={tplLogo}
                              alt=""
                              width={28}
                              height={28}
                              className="object-contain h-auto w-auto max-h-7 dark:brightness-110"
                              sizes="36px"
                              unoptimized
                            />
                          ) : (
                            <Icon className="h-4 w-4" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col items-center gap-1">
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${typeConf.color}`}
                          >
                            {typeConf.label}
                          </span>
                          <ServiceRuntimeStatus
                            running={runtimeByServiceId.get(serviceQueryKeyId(service))}
                            loading={runtimeSnapshot.isLoading}
                            errored={runtimeSnapshot.isError}
                          />
                        </div>
                      </div>

                      <h3 className="line-clamp-2 pr-0.5 text-sm font-semibold leading-tight" title={service.name}>
                        {service.name}
                      </h3>

                      {service.description ? (
                        <p className="mt-1.5 line-clamp-2 flex-1 text-[11px] leading-snug text-muted-foreground">
                          {service.description}
                        </p>
                      ) : (
                        <p className="mt-1.5 flex-1 text-[11px] italic text-muted-foreground/50">No description</p>
                      )}

                      <div className="mt-auto space-y-2 border-t border-white/5 pt-2.5">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" />
                          {format(new Date(service.createdAt), "MMM d, yyyy")}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteService(serviceQueryKeyId(service), service.name)}
                            disabled={isBulkDeleting || deleteService.isPending}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
                            title="Delete service"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div
                            className={`transition-opacity ${
                              servicesBulk.selected.has(serviceQueryKeyId(service))
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100"
                            }`}
                          >
                            <DockerBulkCheckbox
                              checked={servicesBulk.selected.has(serviceQueryKeyId(service))}
                              onCheckedChange={() => servicesBulk.toggle(serviceQueryKeyId(service))}
                              aria-label={`Select service ${service.name}`}
                            />
                          </div>

                          <Link
                            href={serviceDetailHref(
                              projectRouteId,
                              serviceQueryKeyId(service),
                              activeOrgPublicId,
                            )}
                            prefetch
                            className="ml-auto inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                          >
                            Open
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <ListPagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              from={from}
              to={to}
              total={total}
              className="mt-6"
            />
          </>
        )}
      </div>
    </>
  );
}

