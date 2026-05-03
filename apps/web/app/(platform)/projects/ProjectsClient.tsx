"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { FolderKanban, Plus, Search, Trash2, ChevronRight, Clock, Boxes, Loader2, X } from "lucide-react";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useProjectsPage, useCreateProject, useDeleteProject } from "@/hooks/use-projects";
import { useDockerListUrl } from "@/hooks/use-docker-list-url";
import { ListPagination } from "@/components/docker/ListPagination";
import { PROJECTS_PAGE_SIZE, type ProjectsPageResponse } from "@/lib/projects-api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createProjectSchema, CreateProjectInput } from "@/lib/schema";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useOptionalOrgWorkspace } from "@/(platform)/organizations/[publicId]/org-workspace-context";
import {
  orgMemberAllowsProjectAdd,
  orgMemberAllowsProjectDelete,
  orgMemberAllowsProjectView,
} from "@/lib/org-workspace-permissions";

function ServiceCount({ count }: { count: number }) {
  return (
    <span className="text-xs bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5 font-mono">
      {count} services
    </span>
  );
}

function projectRouteId(project: { id: string; publicId?: string }): string {
  const pub = project.publicId?.trim();
  return pub && pub.length > 0 ? pub : project.id;
}

function CreateProjectModal({
  onClose,
  organizationPublicId,
}: {
  onClose: () => void;
  organizationPublicId?: string;
}) {
  const router = useRouter();
  const create = useCreateProject();
  const { toast } = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: "",
      description: "",
      ...(organizationPublicId?.trim()
        ? { organizationPublicId: organizationPublicId.trim() }
        : {}),
    },
  });

  const onSubmit = (data: CreateProjectInput) => {
    const payload: CreateProjectInput =
      organizationPublicId?.trim() != null && organizationPublicId.trim() !== ""
        ? { ...data, organizationPublicId: organizationPublicId.trim() }
        : data;
    create.mutate(payload, {
      onSuccess: () => {
        toast({ title: "Project Created", description: "Your new project is ready." });
        router.refresh();
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

  const closeModal = () => {
    if (create.isPending) return;
    onClose();
  };

  /** Portal to `body`: modal inside `main` (`z-10`) cannot stack above sidebar (`z-40`), so blur never reached it. */
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 modal-scrim"
      onClick={closeModal}
      role="presentation"
    >
      <div
        className="glass-panel rounded-2xl p-8 w-full max-w-lg relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 blur-[60px] pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between gap-3 mb-1">
          <h2 className="text-2xl font-bold min-w-0">New Project</h2>
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
        <p className="text-muted-foreground text-sm mb-6 relative z-10">Create a new project to organize your services.</p>

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
            <button type="button" onClick={onClose} disabled={create.isPending} className="btn-secondary">
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
      </div>
    </div>,
    document.body,
  );
}

export default function ProjectsClient({
  urlPage,
  urlQ,
  initialPageData,
  initialError,
  organizationPublicId,
  initialPageOrganizationId,
}: {
  urlPage: number;
  urlQ: string;
  initialPageData?: ProjectsPageResponse;
  initialError?: string | null;
  /** When set, lists/creates projects scoped to this organization (API `organizationPublicId`). */
  organizationPublicId?: string;
  /** Same as `organizationPublicId` on the server render that produced `initialPageData` (if any). */
  initialPageOrganizationId?: string;
}) {
  const router = useRouter();
  const { page, q, localQ, setLocalQ, setPage } = useDockerListUrl(urlPage, urlQ);
  const [showCreate, setShowCreate] = useState(false);
  const [serverError, setServerError] = useState<string | null>(initialError ?? null);

  const projectDetailBasePath =
    organizationPublicId?.trim() != null && organizationPublicId.trim() !== ""
      ? `/organizations/${encodeURIComponent(organizationPublicId.trim())}/projects`
      : "/projects";

  const inOrgProjects =
    organizationPublicId != null && String(organizationPublicId).trim() !== "";
  const orgWorkspace = useOptionalOrgWorkspace();
  const allowOrgProjectAdd =
    !inOrgProjects ||
    (orgWorkspace != null && orgMemberAllowsProjectAdd(orgWorkspace.workspacePermissions));
  const allowOrgProjectDelete =
    !inOrgProjects ||
    (orgWorkspace != null && orgMemberAllowsProjectDelete(orgWorkspace.workspacePermissions));
  const allowOrgProjectView =
    !inOrgProjects ||
    (orgWorkspace != null && orgMemberAllowsProjectView(orgWorkspace.workspacePermissions));

  const { data: pageData, isLoading, isError, error, refetch } = useProjectsPage(
    page,
    q,
    urlPage,
    urlQ,
    initialPageData,
    organizationPublicId,
    initialPageOrganizationId,
  );
  const deleteProject = useDeleteProject();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const items = pageData?.data ?? [];
  const projectKeys = useMemo(() => items.map((p) => projectRouteId(p)), [items]);
  const projectsBulk = useBulkSelection(projectKeys);
  const total = pageData?.total ?? 0;
  const limit = pageData?.limit ?? PROJECTS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total > 0 ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);

  useEffect(() => {
    if (total > 0 && items.length === 0 && page > 1) {
      setPage(1);
    }
  }, [total, items.length, page, setPage]);

  useEffect(() => {
    if (pageData && !isError) {
      setServerError(null);
    }
  }, [pageData, isError]);

  const handleRetry = async () => {
    setServerError(null);
    await refetch();
    router.refresh();
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete project?",
      description: `“${name}” will be deleted only if it has no services. Delete all services inside it first. This cannot be undone.`,
      confirmLabel: "Delete project",
      variant: "destructive",
    });
    if (!ok) return;

    deleteProject.mutate(
      { id, organizationPublicId: organizationPublicId?.trim() || undefined },
      {
      onSuccess: () => {
        toast({ title: "Project Deleted", description: `"${name}" has been removed.` });
        router.refresh();
      },
      onError: (e: Error) =>
        toast({ title: "Could not delete project", description: e.message, variant: "destructive" }),
    },
    );
  };

  const handleBulkDelete = async () => {
    const ids = projectsBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected projects?",
      description: `Delete ${ids.length} project(s)? Each project is removed only if it has no services.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;

    setIsBulkDeleting(true);
    try {
      const orgPid = organizationPublicId?.trim() || undefined;
      const results = await Promise.allSettled(
        ids.map((id) => deleteProject.mutateAsync({ id, organizationPublicId: orgPid })),
      );
      const removed = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - removed;
      projectsBulk.clear();
      if (removed > 0) router.refresh();
      toast({
        title: fail ? "Some projects could not be deleted" : "Projects deleted",
        description: fail
          ? `${removed} removed, ${fail} failed (empty services from each project first).`
          : `${removed} project(s) removed.`,
        variant: fail ? "destructive" : "default",
      });
    } catch (e) {
      toast({
        title: "Could not delete selected projects",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <>
      {showCreate ? (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          organizationPublicId={organizationPublicId}
        />
      ) : null}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Projects</h1>
          <p className="text-muted-foreground">Organize your services into projects.</p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={!allowOrgProjectAdd}
          title={
            inOrgProjects && !allowOrgProjectAdd
              ? "Your role cannot create projects in this organization"
              : undefined
          }
          className="btn-primary flex items-center gap-2 disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="w-5 h-5" /> New Project
        </button>
      </div>

      <div className="mb-8">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={localQ}
            onChange={(e) => setLocalQ(e.target.value)}
            className="input-field !pl-10 w-full bg-card/50"
          />
        </div>
        {items.length > 0 && allowOrgProjectDelete ? (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <DockerBulkCheckbox
                checked={
                  projectsBulk.allSelected ? true : projectsBulk.someSelected ? "indeterminate" : false
                }
                onCheckedChange={() => projectsBulk.toggleAllFiltered()}
                aria-label="Select all projects on this page"
              />
              <span className="text-sm text-muted-foreground">
                Select all on this page ({items.length})
              </span>
            </div>
            {projectsBulk.selectedInFiltered.length > 0 && (
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting || deleteProject.isPending}
                className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm"
              >
                {isBulkDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete ({projectsBulk.selectedInFiltered.length})
              </button>
            )}
          </div>
        ) : null}
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
      ) : items.length === 0 ? (
        <div className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <FolderKanban className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No projects yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {q.trim()
              ? "No projects match your search."
              : "Create your first project to start organizing services."}
          </p>
          {!q.trim() && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              disabled={!allowOrgProjectAdd}
              title={
                inOrgProjects && !allowOrgProjectAdd
                  ? "Your role cannot create projects in this organization"
                  : undefined
              }
              className="btn-primary flex items-center gap-2 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="w-5 h-5" /> New Project
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {items.map((project) => (
            <div
              key={project.id}
              className="glass-panel backdrop-blur-none rounded-2xl p-6 flex flex-col group interactive-card"
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

                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    {allowOrgProjectDelete ? (
                      <button
                        type="button"
                        onClick={() => handleDelete(projectRouteId(project), project.name)}
                        disabled={isBulkDeleting || deleteProject.isPending}
                        className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : null}
                    {allowOrgProjectDelete ? (
                      <div
                        className={`transition-opacity ${
                          projectsBulk.selected.has(projectRouteId(project))
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        <DockerBulkCheckbox
                          checked={projectsBulk.selected.has(projectRouteId(project))}
                          onCheckedChange={() => projectsBulk.toggle(projectRouteId(project))}
                          aria-label={`Select project ${project.name}`}
                        />
                      </div>
                    ) : null}
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
                  {allowOrgProjectView ? (
                    <Link href={`${projectDetailBasePath}/${projectRouteId(project)}`}>
                      <span className="text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
                        View <ChevronRight className="w-3 h-3" />
                      </span>
                    </Link>
                  ) : (
                    <span
                      className="font-medium flex items-center gap-1 text-muted-foreground opacity-50 cursor-not-allowed"
                      title="Your role cannot open project details in this organization"
                    >
                      View <ChevronRight className="w-3 h-3" />
                    </span>
                  )}
                </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 ? (
        <ListPagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          from={from}
          to={to}
          total={total}
          className="mt-8"
        />
      ) : null}
    </>
  );
}

