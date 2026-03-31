"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { ArrowLeft, Plus, Trash2, ChevronRight, Clock, Container, Layers, Database, Server, Lock, LockOpen } from "lucide-react";
import { useProject } from "@/hooks/use-projects";
import { useServices, useCreateService, useDeleteService } from "@/hooks/use-services";
import { AppLayout } from "@/components/layout/AppLayout";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createServiceSchema, type CreateServiceInput, type Project, type Service } from "@/lib/schema";
import { applyDatabaseApi } from "@/lib/services-api";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { DatabaseEnginePicker } from "@/components/database-engine-picker";
import {
  databaseLogoBlendClass,
  getDatabaseEngineById,
  parseDatabaseEngineFromConfig,
  POSTGRES_DOCKER_IMAGE,
  defaultDatabaseImage,
  defaultDatabaseVolumePath,
} from "@/lib/database-engines";

const SERVICE_TYPE_CONFIG = {
  "docker-compose": {
    label: "Docker Compose",
    color: "bg-zinc-500/10 text-zinc-300 border-zinc-500/20",
    icon: Container,
    placeholder: `version: '3.8'\nservices:\n  app:\n    image: nginx:latest\n    ports:\n      - "80:80"`,
  },
  stack: {
    label: "Stack",
    color: "bg-white/5 text-zinc-200 border-white/10",
    icon: Layers,
    placeholder: `version: '3.8'\nservices:\n  app:\n    image: nginx:latest\n    deploy:\n      replicas: 2`,
  },
  databases: {
    label: "Databases",
    color: "bg-sky-500/10 text-sky-200 border-sky-500/25",
    icon: Database,
    placeholder: "",
  },
} as const;

function dbPortByEngine(engine?: CreateServiceInput["databaseEngine"]): number {
  if (engine === "postgres") return 5432;
  if (engine === "mysql" || engine === "mariadb") return 3306;
  if (engine === "mongodb") return 27017;
  if (engine === "redis") return 6379;
  return 5432;
}

function CreateServiceModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const create = useCreateService();
  const { toast } = useToast();
  const [dbPickerOpen, setDbPickerOpen] = useState(false);
  const [imageUnlocked, setImageUnlocked] = useState(false);
  const { register, handleSubmit, formState: { errors }, watch, setValue, getValues } = useForm<CreateServiceInput>({
    resolver: zodResolver(createServiceSchema) as Resolver<CreateServiceInput>,
    defaultValues: {
      name: "",
      projectId,
      type: "docker-compose",
      config: "",
      description: "",
      databaseEngine: undefined,
      postgres: {
        dbName: "",
        user: "",
        pass: "",
        rootUser: "",
        rootPass: "",
        password: "",
        storeDbName: "env",
        storeUser: "env",
        storePass: "secret",
        storeRootUser: "env",
        storeRootPass: "secret",
        storePassword: "secret",
        volumePath: "",
        replicas: 1,
        publishPort: "",
        image: POSTGRES_DOCKER_IMAGE,
      },
    },
  });

  const type = watch("type");
  const databaseEngine = watch("databaseEngine");

  useEffect(() => {
    if (type !== "databases") {
      setValue("databaseEngine", undefined);
      setImageUnlocked(false);
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
        storeDbName: "env",
        storeUser: "env",
        storePass: "secret",
        storeRootUser: "env",
        storeRootPass: "secret",
        storePassword: "secret",
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
    if (type === "databases" && !databaseEngine) {
      setDbPickerOpen(true);
    }
  }, [type, databaseEngine]);

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
          storeDbName: data.postgres.storeDbName,
          storeUser: data.postgres.storeUser,
          storePass: data.postgres.storePass,
          storeRootUser: data.postgres.storeRootUser,
          storeRootPass: data.postgres.storeRootPass,
          storePassword: data.postgres.storePassword,
          volumePath: data.postgres.volumePath.trim() || undefined,
          replicas: data.postgres.replicas ?? 1,
          ...(pp ? { publishPort: parseInt(pp, 10) } : {}),
          ...(img ? { image: img } : {}),
        });
        await qc.invalidateQueries({ queryKey: ["service", created.id] });
      }
      toast({
        title: "Service Created",
        description:
          data.type === "databases" && data.databaseEngine
            ? "Database stack and credentials are saved. Deploy from the service page when ready."
            : "Your new service is ready.",
      });
      onClose();
    } catch (e: unknown) {
      toast({
        title: "Could not create service",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 left-64 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
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
            setValue("type", "docker-compose");
          }
        }}
      />
      <motion.div
        initial={false}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-panel rounded-2xl p-8 w-full max-w-2xl relative overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 blur-[60px] pointer-events-none" />
        <h2 className="text-2xl font-bold mb-1">New Service</h2>
        <p className="text-muted-foreground text-sm mb-6">Add a service to this project.</p>

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
              <select {...register("type")} className="input-field appearance-none cursor-pointer">
                <option value="docker-compose" className="bg-card">Docker Compose</option>
                <option value="stack" className="bg-card">Stack</option>
                <option value="databases" className="bg-card">Databases</option>
              </select>
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
              {errors.databaseEngine && (
                <p className="text-destructive text-xs mt-1">{errors.databaseEngine.message}</p>
              )}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input {...register("description")} className="input-field" placeholder="Short description of this service" />
          </div>

          {type === "databases" && databaseEngine && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-sky-200 mb-0.5">
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
                  <select {...register("postgres.storeDbName")} className="input-field mt-1.5 w-full max-w-[12rem] text-xs">
                    <option value="env">Store in Environment</option>
                    <option value="secret">Store in Docker Secret</option>
                  </select>
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
                  <select {...register("postgres.storeUser")} className="input-field mt-1.5 w-full max-w-[12rem] text-xs">
                    <option value="env">Store in Environment</option>
                    <option value="secret">Store in Docker Secret</option>
                  </select>
                  {errors.postgres?.user && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.user.message}</p>
                  )}
                </div>
                )}
                {(databaseEngine === "postgres" || databaseEngine === "mysql" || databaseEngine === "mariadb") && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password</label>
                  <input
                    type="password"
                    {...register("postgres.pass")}
                    className="input-field w-full font-mono text-sm"
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <select {...register("postgres.storePass")} className="input-field mt-1.5 w-full max-w-[12rem] text-xs">
                    <option value="secret">Store in Docker Secret</option>
                    <option value="env">Store in Environment</option>
                  </select>
                  {errors.postgres?.pass && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.pass.message}</p>
                  )}
                </div>
                )}
                {(databaseEngine === "mysql" || databaseEngine === "mariadb") && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root Password</label>
                  <input
                    type="password"
                    {...register("postgres.rootPass")}
                    className="input-field w-full font-mono text-sm"
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <select {...register("postgres.storeRootPass")} className="input-field mt-1.5 w-full max-w-[12rem] text-xs">
                    <option value="secret">Store in Docker Secret</option>
                    <option value="env">Store in Environment</option>
                  </select>
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
                  <select {...register("postgres.storeRootUser")} className="input-field mt-1.5 w-full max-w-[12rem] text-xs">
                    <option value="env">Store in Environment</option>
                    <option value="secret">Store in Docker Secret</option>
                  </select>
                  {errors.postgres?.rootUser && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.rootUser.message}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Root Password</label>
                  <input
                    type="password"
                    {...register("postgres.rootPass")}
                    className="input-field w-full font-mono text-sm"
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <select {...register("postgres.storeRootPass")} className="input-field mt-1.5 w-full max-w-[12rem] text-xs">
                    <option value="secret">Store in Docker Secret</option>
                    <option value="env">Store in Environment</option>
                  </select>
                  {errors.postgres?.rootPass && (
                    <p className="text-destructive text-xs mt-1">{errors.postgres.rootPass.message}</p>
                  )}
                </div>
                </>
                )}
                {databaseEngine === "redis" && (
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Password</label>
                  <input
                    type="password"
                    {...register("postgres.password")}
                    className="input-field w-full font-mono text-sm"
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <select {...register("postgres.storePassword")} className="input-field mt-1.5 w-full max-w-[12rem] text-xs">
                    <option value="secret">Store in Docker Secret</option>
                    <option value="env">Store in Environment</option>
                  </select>
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
            <button type="button" onClick={onClose} className="btn-secondary">
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
      </motion.div>
    </div>
  );
}

export default function ProjectsIdClient({
  projectId,
  initialProject,
  initialServices,
  initialProjectError,
}: {
  projectId: string;
  initialProject?: Project | null;
  initialServices?: Service[];
  initialProjectError?: string | null;
}) {
  const [showCreate, setShowCreate] = useState(false);

  const { data: project, isLoading: projectLoading } = useProject(projectId, {
    initialData: initialProject ?? undefined,
  });

  const {
    data: services,
    isLoading: servicesLoading,
    isError: servicesError,
    error: servicesErr,
    refetch: refetchServices,
  } = useServices(projectId, {
    initialData: initialServices,
  });

  const deleteService = useDeleteService();
  const { toast } = useToast();
  const confirm = useConfirm();

  const handleDeleteService = async (serviceId: string, name: string) => {
    const ok = await confirm({
      title: "Delete this service?",
      description: `“${name}” will be removed from this project. This may stop related workloads on the server.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    deleteService.mutate(serviceId, {
      onSuccess: () => toast({ title: "Service Deleted", description: `"${name}" removed.` }),
      onError: (e: Error) =>
        toast({ title: "Could not delete service", description: e.message, variant: "destructive" }),
    });
  };

  if (projectLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">
            {initialProjectError ? initialProjectError : "Project not found."}
          </p>
          <Link href="/projects">
            <button className="btn-secondary mt-4">Back to Projects</button>
          </Link>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <AnimatePresence>
        {showCreate && <CreateServiceModal projectId={projectId} onClose={() => setShowCreate(false)} />}
      </AnimatePresence>

      <Link href="/projects">
        <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8 text-sm font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Projects
        </button>
      </Link>

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
          Services <span className="text-muted-foreground font-normal text-base ml-1">({services?.length ?? 0})</span>
        </h2>

        {servicesError && (
          <div className="glass-panel rounded-xl p-4 mb-4 border border-destructive/30 text-sm">
            <p className="font-medium text-destructive">Could not load services</p>
            <p className="text-muted-foreground mt-1">{servicesErr instanceof Error ? servicesErr.message : "Unknown error"}</p>
            <button type="button" onClick={() => refetchServices()} className="btn-secondary mt-3 text-xs">
              Retry
            </button>
          </div>
        )}

        {servicesLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !services || services.length === 0 ? (
          <motion.div
            initial={false}
            animate={{ opacity: 1 }}
            className="glass-panel p-10 rounded-2xl flex flex-col items-center justify-center text-center"
          >
            <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
              <Container className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-bold mb-2">No services yet</h3>
            <p className="text-muted-foreground mb-6 text-sm max-w-sm">
              Add your first service (Docker Compose, Stack, or Databases) to this project.
            </p>
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Service
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
            <AnimatePresence>
              {services.map((service, idx) => {
                const typeConf = SERVICE_TYPE_CONFIG[service.type as keyof typeof SERVICE_TYPE_CONFIG] ??
                  SERVICE_TYPE_CONFIG["docker-compose"];
                const Icon = typeConf.icon;
                const dbEngineId =
                  service.type === "databases" ? parseDatabaseEngineFromConfig(service.config) : undefined;
                const dbLogo = dbEngineId ? getDatabaseEngineById(dbEngineId)?.logoSrc : undefined;

                return (
                  <motion.div
                    key={service.id}
                    layout
                    initial={false}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ delay: idx * 0.04 }}
                    className="group relative flex flex-col rounded-xl border border-white/5 bg-gradient-to-b from-white/[0.06] to-transparent p-3 shadow-sm transition-all duration-300 hover:border-primary/20 hover:shadow-[0_6px_28px_-10px_rgba(0,0,0,0.35)] md:aspect-square max-md:min-h-[180px]"
                  >
                    <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

                    <div className="relative flex min-h-0 flex-1 flex-col">
                      <div className="mb-2 flex items-start justify-between gap-1.5">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg overflow-hidden ${
                            service.isActive
                              ? dbLogo
                                ? "border border-sky-500/25 bg-transparent p-0.5"
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
                              className={`object-contain max-h-7 w-auto ${databaseLogoBlendClass(dbEngineId)}`}
                              sizes="36px"
                            />
                          ) : (
                            <Icon className="h-4 w-4" />
                          )}
                        </div>
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${typeConf.color}`}>
                          {typeConf.label}
                        </span>
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
                            onClick={() => handleDeleteService(service.id, service.name)}
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                            title="Delete service"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>

                          <Link
                            href={`/projects/${projectId}/services/${service.id}`}
                            className="ml-auto inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                          >
                            Open
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

