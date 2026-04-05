"use client";

import { useEffect, useMemo } from "react";
import type { Service } from "@/lib/schema";
import {
  backupFormatOptionsForEngine,
  defaultBackupFormatForEngine,
  describeDatabaseBackupPreview,
  resolveBackupFormat,
  type DatabaseBackupFormatId,
  type DatabaseBackupFormValues,
} from "@/lib/database-backup-preview";
import {
  formsEqual,
  listDatabaseBackupOptions,
  parseComposeServiceKeys,
} from "@/lib/database-backup-from-service";
import { getDatabaseEngineById, parseDatabaseEngineFromConfig } from "@/lib/database-engines";

type Props = {
  /** Deployed database stack; used to list real DB instances from compose + env. */
  service: Service | null;
  values: DatabaseBackupFormValues;
  onChange: (patch: Partial<DatabaseBackupFormValues>) => void;
  onReplaceValues: (next: DatabaseBackupFormValues) => void;
  /**
   * When true, only the backup format control is shown. Engine, compose target, DB name, and user
   * stay synced from the stack in state (effects still run) for backup/import APIs.
   */
  formatOnly?: boolean;
};

/**
 * Single panel: presets when multiple DBs in stack, then editable fields + preview.
 * No separate “manual” mode — user always sees values and may edit.
 */
export function DatabaseBackupFormFields({
  service,
  values,
  onChange,
  onReplaceValues,
  formatOnly = false,
}: Props) {
  const options = useMemo(
    () => listDatabaseBackupOptions(service, service?.name),
    [service],
  );
  const knownEngineFromStack = useMemo((): string | undefined => {
    if (!service || service.type !== "databases") return undefined;
    return parseDatabaseEngineFromConfig(service.config ?? "");
  }, [service]);

  const preview = useMemo(() => describeDatabaseBackupPreview(values), [values]);

  const selectedIdx = useMemo(() => {
    const i = options.findIndex((o) => formsEqual(o.form, values));
    return i >= 0 ? i : 0;
  }, [options, values]);

  useEffect(() => {
    if (!knownEngineFromStack) return;
    if (values.engine !== knownEngineFromStack) {
      onChange({ engine: knownEngineFromStack as DatabaseBackupFormValues["engine"] });
    }
  }, [knownEngineFromStack, values.engine, onChange]);

  useEffect(() => {
    if (!service || service.type !== "databases") return;
    const keys = parseComposeServiceKeys(service.config ?? "");
    if (keys.length === 0) return;
    const cur = values.composeService.trim();
    if (keys.length === 1) {
      if (cur !== keys[0]) onChange({ composeService: keys[0]! });
      return;
    }
    if (!cur || !keys.includes(cur)) {
      onChange({ composeService: keys[0]! });
    }
  }, [service, values.composeService, onChange]);

  if (formatOnly) {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Backup format</label>
          <select
            className="input-field"
            value={resolveBackupFormat(values.engine, values.backupFormat)}
            onChange={(e) =>
              onChange({ backupFormat: e.target.value as DatabaseBackupFormatId })
            }
          >
            {backupFormatOptionsForEngine(values.engine).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {options.length > 1 && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Which database <span className="font-normal">(this stack has several)</span>
          </label>
          <select
            className="input-field"
            value={String(Math.min(selectedIdx, options.length - 1))}
            onChange={(e) => {
              const idx = Number(e.target.value);
              const opt = options[idx];
              if (opt) onReplaceValues(opt.form);
            }}
          >
            {options.map((o, i) => (
              <option key={`${o.form.composeService}-${i}`} value={String(i)}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground mt-1">
            You can still change name, user, or preview below.
          </p>
        </div>
      )}
      {options.length === 1 && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Filled from your stack — <span className="text-foreground/90">{options[0]!.label}</span>. Edit
          anything below if needed.
        </p>
      )}
      {options.length === 0 && service && service.type === "databases" && (
        <p className="text-xs text-amber-400/90 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2">
          Could not read engine / services from this stack&apos;s YAML. Fill the fields below, or ensure the
          service has <code className="text-amber-200/90"># engine:</code> and{" "}
          <code className="text-amber-200/90">services:</code> in the compose file.
        </p>
      )}
      {knownEngineFromStack ? (
        <div className="rounded-lg border border-border bg-muted/55 dark:bg-black/25 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground mb-0.5">Database engine</p>
          <p className="text-sm font-medium text-foreground">
            {getDatabaseEngineById(knownEngineFromStack)?.name ?? knownEngineFromStack}
          </p>
        </div>
      ) : (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Database engine</label>
          <select
            className="input-field"
            value={values.engine}
            onChange={(e) => {
              const eng = e.target.value as DatabaseBackupFormValues["engine"];
              onChange({
                engine: eng,
                backupFormat: defaultBackupFormatForEngine(eng),
              });
            }}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mariadb">MariaDB</option>
            <option value="mongodb">MongoDB</option>
            <option value="redis">Redis</option>
          </select>
        </div>
      )}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Backup format</label>
        <select
          className="input-field"
          value={resolveBackupFormat(values.engine, values.backupFormat)}
          onChange={(e) =>
            onChange({ backupFormat: e.target.value as DatabaseBackupFormatId })
          }
        >
          {backupFormatOptionsForEngine(values.engine).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {values.engine !== "redis" && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Database name</label>
          <input
            className="input-field font-mono text-sm"
            value={values.databaseName}
            onChange={(e) => onChange({ databaseName: e.target.value })}
            placeholder="e.g. myapp"
            autoComplete="off"
          />
        </div>
      )}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          DB user <span className="font-normal">(optional)</span>
        </label>
        <input
          className="input-field font-mono text-sm"
          value={values.dbUser}
          onChange={(e) => onChange({ dbUser: e.target.value })}
          placeholder={
            values.engine === "postgres"
              ? "default: postgres"
              : values.engine === "mysql" || values.engine === "mariadb"
                ? "default: root"
                : "optional"
          }
          autoComplete="off"
        />
        {values.engine === "mongodb" || values.engine === "redis" ? (
          <p className="text-[11px] text-muted-foreground mt-1">Not used for this engine.</p>
        ) : null}
      </div>
      <div className="rounded-lg border border-border bg-muted/65 dark:bg-black/30 px-3 py-2.5">
        <p className="text-[11px] font-medium text-muted-foreground mb-1.5">What will run</p>
        <p className="font-mono text-xs text-foreground/95 whitespace-pre-wrap break-all leading-relaxed">
          {preview}
        </p>
      </div>
    </div>
  );
}
