"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { FolderKanban, Plus, Search, Trash2, ChevronRight, Clock, Boxes } from "lucide-react";
import { useProjects, useCreateProject, useDeleteProject } from "@/hooks/use-projects";
import { AppLayout } from "@/components/layout/AppLayout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createProjectSchema, CreateProjectInput, type Project } from "@/lib/schema";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";

function ServiceCount({ count }: { count: number }) {
  return (
    <span className="text-xs bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 font-mono">
      {count} services
    </span>
  );
}

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const create = useCreateProject();
  const { toast } = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", description: "" },
  });

  const onSubmit = (data: CreateProjectInput) => {
    create.mutate(data, {
      onSuccess: () => {
        toast({ title: "Project Created", description: "Your new project is ready." });
        onClose();
      },
      onError: (e: Error) =>
        toast({
          title: "Could not create project",
          description: e.message,
          variant: "destructive",
        }),
    });
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 left-64 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={false}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-panel rounded-2xl p-8 w-full max-w-lg relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 blur-[60px] pointer-events-none" />
        <h2 className="text-2xl font-bold mb-1">New Project</h2>
        <p className="text-muted-foreground text-sm mb-6">Create a new project to organize your services.</p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 relative z-10">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Project Name</label>
            <input {...register("name")} className="input-field" placeholder="e.g., Production Infrastructure" />
            {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Description <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <textarea
              {...register("description")}
              className="input-field min-h-[90px] resize-none"
              placeholder="What is this project about?"
            />
          </div>

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
                "Create Project"
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default function ProjectsClient({
  projects: initialProjects,
  initialError,
}: {
  projects: Project[];
  initialError?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [serverError, setServerError] = useState<string | null>(initialError ?? null);

  const { data: projects, isLoading, isError, error, refetch } = useProjects(initialProjects);
  const deleteProject = useDeleteProject();
  const { toast } = useToast();
  const confirm = useConfirm();

  const filtered =
    projects?.filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.description || "").toLowerCase().includes(search.toLowerCase()),
    ) ?? [];

  const handleRetry = async () => {
    setServerError(null);
    await refetch();
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete project?",
      description: `“${name}” will be deleted only if it has no services. Delete all services inside it first. This cannot be undone.`,
      confirmLabel: "Delete project",
      variant: "destructive",
    });
    if (!ok) return;

    deleteProject.mutate(id, {
      onSuccess: () => toast({ title: "Project Deleted", description: `"${name}" has been removed.` }),
      onError: (e: Error) =>
        toast({ title: "Could not delete project", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <AppLayout>
      <AnimatePresence>{showCreate && <CreateProjectModal onClose={() => setShowCreate(false)} />}</AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Projects</h1>
          <p className="text-muted-foreground">Organize your services into projects.</p>
        </div>

        <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-5 h-5" /> New Project
        </button>
      </div>

      <div className="mb-8 relative">
        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field !pl-12 max-w-md bg-card/50"
        />
      </div>

      {(serverError || isError) && (
        <div className="glass-panel rounded-xl p-4 mb-6 border border-destructive/30 text-sm text-destructive">
          <p className="font-medium">Could not load projects</p>
          <p className="text-muted-foreground mt-1">
            {serverError ?? (error instanceof Error ? error.message : "Unknown error")}
          </p>
          <button type="button" onClick={handleRetry} className="btn-secondary mt-3 text-xs">
            Retry
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center text-center"
        >
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <FolderKanban className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No projects yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No projects match your search." : "Create your first project to start organizing services."}
          </p>
          {!search && (
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> New Project
            </button>
          )}
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <AnimatePresence>
            {filtered.map((project) => (
              <motion.div
                key={project.id}
                layout
                initial={false}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="glass-panel rounded-2xl p-6 flex flex-col group interactive-card"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg flex-shrink-0 bg-primary/10 text-primary">
                      <Boxes className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="font-semibold text-lg leading-tight truncate"
                        title={project.name}
                      >
                        {project.name}
                      </h3>
                      <div className="mt-1">
                        <ServiceCount count={project.serviceCount ?? 0} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                    <button
                      onClick={() => handleDelete(project.id, project.name)}
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {project.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{project.description}</p>
                )}

                <div className="mt-auto pt-4 border-t border-white/5 flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(new Date(project.createdAt), "MMM d, yyyy")}
                  </div>
                  <Link href={`/projects/${project.id}`}>
                    <span className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
                      View <ChevronRight className="w-3 h-3" />
                    </span>
                  </Link>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </AppLayout>
  );
}

