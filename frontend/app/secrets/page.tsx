"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  KeyRound,
  Plus,
  Search,
  Trash2,
  ShieldCheck,
  Pencil,
  Lock,
  Upload,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  useDockerSecrets,
  useCreateDockerSecret,
  useDeleteDockerSecret,
  useReplaceDockerSecret,
  useBulkImportDockerSecrets,
} from "@/hooks/use-docker-secrets";
import { AppLayout } from "@/components/layout/AppLayout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createDockerSecretSchema,
  replaceDockerSecretSchema,
  type CreateDockerSecretInput,
  type ReplaceDockerSecretInput,
  type DockerSecretListItem,
} from "@/lib/schema";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { deleteDockerSecretApi } from "@/lib/docker-secrets-api";
import { formatSecretDate } from "@/lib/format-secret-date";

function CreateSecretModal({ onClose }: { onClose: () => void }) {
  const create = useCreateDockerSecret();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateDockerSecretInput>({
    resolver: zodResolver(createDockerSecretSchema),
  });

  const onSubmit = (data: CreateDockerSecretInput) => {
    create.mutate(data, {
      onSuccess: () => {
        toast({ title: "Secret created", description: `Docker secret "${data.name}" was created in Swarm.` });
        onClose();
      },
      onError: (e: Error) => {
        toast({ title: "Failed", description: e.message, variant: "destructive" });
      },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-panel rounded-2xl p-8 w-full max-w-lg relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 blur-[60px] pointer-events-none" />
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">New Docker secret</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Creates a secret on the Docker host (Swarm). The value is sent once and cannot be read back from Docker.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 relative z-10">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Secret name</label>
            <input
              {...register("name")}
              className="input-field font-mono"
              placeholder="e.g. db_password or my.secret"
              autoComplete="off"
            />
            {errors.name && <p className="text-destructive text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Secret value</label>
            <input
              {...register("value")}
              type="password"
              className="input-field font-mono"
              placeholder="Paste secret value…"
              autoComplete="new-password"
            />
            {errors.value && <p className="text-destructive text-xs mt-1">{errors.value.message}</p>}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={create.isPending} className="btn-primary flex items-center gap-2">
              {create.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> Creating…
                </>
              ) : (
                "Create secret"
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function EditSecretModal({ secret, onClose }: { secret: DockerSecretListItem; onClose: () => void }) {
  const replace = useReplaceDockerSecret();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReplaceDockerSecretInput>({
    resolver: zodResolver(replaceDockerSecretSchema),
    defaultValues: { name: secret.name, value: "" },
  });

  const onSubmit = (data: ReplaceDockerSecretInput) => {
    replace.mutate(
      { name: data.name, value: data.value },
      {
        onSuccess: () => {
          toast({
            title: "Secret updated",
            description: `Secret "${data.name}" was replaced (removed and recreated with the new value).`,
          });
          onClose();
        },
        onError: (e: Error) => {
          toast({ title: "Failed", description: e.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="glass-panel rounded-2xl p-8 w-full max-w-lg relative overflow-hidden"
      >
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Pencil className="w-5 h-5 text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold">Replace secret value</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Docker does not expose existing secret data. To rotate, we remove this secret and create a new one with the same name and your new value.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Secret name</label>
            <input {...register("name")} readOnly className="input-field font-mono opacity-80 cursor-not-allowed" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">New value</label>
            <input
              {...register("value")}
              type="password"
              className="input-field font-mono"
              placeholder="New secret value…"
              autoComplete="new-password"
            />
            {errors.value && <p className="text-destructive text-xs mt-1">{errors.value.message}</p>}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={replace.isPending} className="btn-primary flex items-center gap-2">
              {replace.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> Replacing…
                </>
              ) : (
                "Replace secret"
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function BulkImportPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const bulk = useBulkImportDockerSecrets();
  const { toast } = useToast();

  const run = () => {
    if (!text.trim()) return;
    bulk.mutate(text, {
      onSuccess: (res) => {
        toast({
          title: "Import finished",
          description: res.message + (res.failed.length ? ` ${res.failed.length} failed.` : ""),
        });
        if (res.failed.length) {
          console.warn(res.failed);
        }
        onClose();
      },
      onError: (e: Error) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="glass-panel rounded-xl p-5 border border-primary/20 mb-6 overflow-hidden"
    >
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Upload className="w-4 h-4 text-primary" />
        Import from .env
      </h3>
      <p className="text-xs text-muted-foreground mb-3">One KEY=value per line. Lines starting with # are skipped.</p>
      <textarea
        className="input-field font-mono text-sm min-h-[120px] resize-y w-full"
        placeholder={"DB_HOST=localhost\nAPI_KEY=..."}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex justify-end gap-2 mt-3">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">
          Cancel
        </button>
        <button type="button" onClick={run} disabled={bulk.isPending || !text.trim()} className="btn-primary text-sm flex items-center gap-2">
          {bulk.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Import
        </button>
      </div>
    </motion.div>
  );
}

function SecretRow({
  secret,
  onEdit,
  selected,
  onToggleSelect,
}: {
  secret: DockerSecretListItem;
  onEdit: (s: DockerSecretListItem) => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const deleteSecret = useDeleteDockerSecret();
  const { toast } = useToast();
  const confirm = useConfirm();

  const handleDelete = async () => {
    const ok = await confirm({
      title: "Delete Docker secret?",
      description: `“${secret.name}” will be removed from the Swarm. This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    deleteSecret.mutate(secret.name, {
      onSuccess: () => toast({ title: "Secret deleted", description: secret.name }),
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });
  };

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="border-b border-white/5 hover:bg-white/2 group transition-colors"
    >
      <td className="py-4 px-3 w-12 align-middle">
        <DockerBulkCheckbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Select ${secret.name}`}
        />
      </td>
      <td className="py-4 px-5">
        <span className="font-mono text-sm text-primary font-medium">{secret.name}</span>
      </td>
      <td className="py-4 px-5">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Not readable (Docker Swarm)
        </span>
      </td>
      <td className="py-4 px-5">
        <span className="text-xs text-muted-foreground">{formatSecretDate(secret.createdAt)}</span>
      </td>
      <td className="py-4 px-5">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
          <button
            type="button"
            onClick={() => onEdit(secret)}
            className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Replace value (rotate)"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-destructive/20 text-destructive transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </motion.tr>
  );
}

export default function DockerSecrets() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<DockerSecretListItem | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const { data: secrets, isLoading, isError, error } = useDockerSecrets();
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();

  const filtered = useMemo(
    () =>
      secrets?.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())) ?? [],
    [secrets, search],
  );

  const filteredKeys = useMemo(() => filtered.map((s) => s.name), [filtered]);
  const bulk = useBulkSelection(filteredKeys);

  const handleBulkDeleteSecrets = async () => {
    const names = bulk.selectedInFiltered;
    if (names.length === 0) return;
    const confirmed = await confirm({
      title: "Delete multiple secrets?",
      description: `Delete ${names.length} Docker secret(s)? This cannot be undone.`,
      confirmLabel: "Delete all",
      variant: "destructive",
    });
    if (!confirmed) return;
    setBulkPending(true);
    const results = await Promise.allSettled(names.map((n) => deleteDockerSecretApi(n)));
    setBulkPending(false);
    const removed = results.filter((r) => r.status === "fulfilled").length;
    const fail = results.length - removed;
    bulk.clear();
    await qc.invalidateQueries({ queryKey: ["docker-secrets"] });
    toast({
      title: "Bulk delete finished",
      description: `${removed} removed${fail ? `, ${fail} failed` : ""}.`,
      variant: fail ? "destructive" : "default",
    });
  };

  return (
    <AppLayout>
      <AnimatePresence>
        {showCreate && <CreateSecretModal onClose={() => setShowCreate(false)} />}
        {editing && <EditSecretModal secret={editing} onClose={() => setEditing(null)} />}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Docker Secrets</h1>
          <p className="text-muted-foreground">
            Manage Swarm secrets on the Docker host. Values are never shown after creation; you can rotate by replacing or delete secrets here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bulk.selectedInFiltered.length > 0 && (
            <button
              type="button"
              onClick={handleBulkDeleteSecrets}
              disabled={bulkPending}
              className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2"
            >
              {bulkPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
              Delete ({bulk.selectedInFiltered.length})
            </button>
          )}
          <button type="button" onClick={() => setShowBulk((v) => !v)} className="btn-secondary flex items-center gap-2">
            <Upload className="w-5 h-5" />
            {showBulk ? "Hide import" : "Import .env"}
          </button>
          <button type="button" onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" /> New secret
          </button>
        </div>
      </div>

      <AnimatePresence>{showBulk && <BulkImportPanel onClose={() => setShowBulk(false)} />}</AnimatePresence>

      <div className="mb-3 relative">
        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field !pl-12 max-w-md bg-card/50"
        />
      </div>

      {filtered.length > 0 && !isError && (
        <div className="flex items-center gap-3 mb-6 text-sm">
          <label className="flex items-center gap-2.5 cursor-pointer text-muted-foreground hover:text-foreground select-none">
            <DockerBulkCheckbox
              checked={bulk.allSelected ? true : bulk.someSelected ? "indeterminate" : false}
              onCheckedChange={() => bulk.toggleAllFiltered()}
              aria-label="Select all secrets in list"
            />
            <span>Select all in list ({filtered.length})</span>
          </label>
          {bulk.selectedInFiltered.length > 0 && (
            <span className="text-xs text-muted-foreground">{bulk.selectedInFiltered.length} selected</span>
          )}
        </div>
      )}

      {isError && (
        <div className="glass-panel rounded-xl p-4 mb-6 border border-destructive/30 flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">Could not load secrets</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{error instanceof Error ? error.message : "Unknown error"}</p>
            <p className="text-muted-foreground text-xs mt-2">
              Docker Swarm must be initialized and the API must run where <code className="text-xs">docker secret</code> works. Check{" "}
              <code className="text-xs">NEXT_PUBLIC_API_URL</code>.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 && !isError ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center text-center"
        >
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <ShieldCheck className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No secrets yet</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {search ? "No secrets match your search." : "Create a secret or import a .env file. Secret values are never displayed after creation."}
          </p>
          {!search && (
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" /> New secret
            </button>
          )}
        </motion.div>
      ) : !isError ? (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="w-12 py-3 px-3" />
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Value</th>
                <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                <th className="py-3 px-5" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {filtered.map((secret) => (
                  <SecretRow
                    key={`${secret.id}-${secret.name}`}
                    secret={secret}
                    onEdit={setEditing}
                    selected={bulk.selected.has(secret.name)}
                    onToggleSelect={() => bulk.toggle(secret.name)}
                  />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      ) : null}
    </AppLayout>
  );
}
