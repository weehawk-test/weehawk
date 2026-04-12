"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Link2, X } from "lucide-react";
import { useServices } from "@/hooks/use-services";
import type { Service } from "@/lib/schema";
import { buildApplicationConnectionOptions, buildDatabaseConnectionOptions } from "@/lib/project-networks";

export function ApplicationConnectionsPanel({
  service,
  projectId,
  variant = "card",
  external,
  stackKeys,
  onExternalChange,
  onStackKeysChange,
  open = false,
  onOpenChange,
}: {
  service: Service;
  projectId: string;
  /** `embedded`: no outer card — for use inside Application source upload. */
  variant?: "card" | "embedded";
  external: string[];
  stackKeys: string[];
  onExternalChange: (next: string[]) => void;
  onStackKeysChange: (next: string[]) => void;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) {
  const { data: projectServices } = useServices(projectId);
  const list = projectServices ?? [];
  const databaseOptions = useMemo(
    () => buildDatabaseConnectionOptions(list, service.id),
    [list, service.id],
  );
  const applicationOptions = useMemo(
    () => buildApplicationConnectionOptions(list, service.id),
    [list, service.id],
  );

  const dbValueSet = useMemo(() => new Set(databaseOptions.map((o) => o.value)), [databaseOptions]);
  const appValueSet = useMemo(() => new Set(applicationOptions.map((o) => o.value)), [applicationOptions]);
  const selectedDatabases = useMemo(() => external.filter((v) => dbValueSet.has(v)), [external, dbValueSet]);
  const selectedApplications = useMemo(() => external.filter((v) => appValueSet.has(v)), [external, appValueSet]);

  const [dbSelectKey, setDbSelectKey] = useState(0);
  const [appSelectKey, setAppSelectKey] = useState(0);

  const labelFor = (options: { value: string; label: string }[], value: string) =>
    options.find((o) => o.value === value)?.label ?? value;

  const removeExternal = (value: string) => onExternalChange(external.filter((x) => x !== value));

  const renderConnectionDropdown = (
    options: { value: string; label: string }[],
    selectedInCategory: string[],
    emptyMessage: string,
    placeholder: string,
    selectKey: number,
    bumpSelectKey: () => void,
  ) => {
    if (options.length === 0) {
      return <p className="text-[11px] text-muted-foreground leading-snug">{emptyMessage}</p>;
    }
    const available = options.filter((o) => !external.includes(o.value));
    return (
      <div className="space-y-2">
        {available.length > 0 ? (
          <select
            key={selectKey}
            defaultValue=""
            aria-label={placeholder}
            className="input-field w-full cursor-pointer text-sm"
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                onExternalChange(external.includes(v) ? external : [...external, v]);
                bumpSelectKey();
              }
            }}
          >
            <option value="" disabled>
              {placeholder}
            </option>
            {available.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : selectedInCategory.length > 0 ? (
          <p className="text-[11px] text-muted-foreground leading-snug">Everything in this list is already connected.</p>
        ) : null}
        {selectedInCategory.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedInCategory.map((v) => (
              <span
                key={v}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/90 px-2 py-1 text-[11px] text-foreground dark:border-white/15 dark:bg-zinc-950/50"
              >
                <span className="max-w-[220px] truncate">{labelFor(options, v)}</span>
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  aria-label={`Remove ${labelFor(options, v)}`}
                  onClick={() => removeExternal(v)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const shellOuter =
    variant === "embedded"
      ? "border-t border-border pt-4 mt-4 dark:border-white/10"
      : "glass-panel rounded-2xl border border-violet-500/25 bg-violet-500/5 p-5";

  const connectionCount = selectedDatabases.length + selectedApplications.length + stackKeys.filter((k) => k.trim()).length;

  return (
    <div className={shellOuter}>
      <details
        className="group"
        open
      >
        <summary
          onClick={(e) => {
            e.preventDefault();
            onOpenChange?.(!open);
          }}
          className={`flex cursor-pointer list-none items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors [&::-webkit-details-marker]:hidden ${
            variant === "embedded"
              ? "border-border bg-muted/35 hover:bg-muted/55 dark:border-white/10 dark:bg-zinc-950/30 dark:hover:bg-white/[0.04]"
              : "border-violet-500/25 bg-muted/35 hover:bg-muted/50 dark:border-white/10 dark:bg-zinc-950/30 dark:hover:bg-white/[0.04]"
          }`}
        >
          <div
            className={`flex shrink-0 items-center justify-center rounded-xl border border-violet-400/40 bg-violet-500/[0.12] dark:border-violet-500/30 dark:bg-violet-500/10 ${variant === "embedded" ? "h-8 w-8" : "h-9 w-9"}`}
          >
            <Link2 className={`text-violet-700 dark:text-violet-300 ${variant === "embedded" ? "h-3.5 w-3.5" : "h-4 w-4"}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-violet-900 dark:text-violet-100">Connections</h3>
              {connectionCount > 0 && (
                <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:text-violet-200">
                  {connectionCount}
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-600 dark:text-muted-foreground mt-0.5 leading-snug">
              Link databases and apps; optionally add extra Swarm overlay networks. Saved with your app settings.
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-zinc-500 dark:text-muted-foreground transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
          />
        </summary>

        <div
          className={`grid min-h-0 overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-80"
          }`}
        >
          <div className="min-h-0 space-y-5 pt-3">
          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-foreground">Connect to existing Database</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Select databases this app should reach.</p>
            </div>
            {renderConnectionDropdown(
              databaseOptions,
              selectedDatabases,
              "No databases in this project yet, or they are not ready to connect.",
              "Choose a database…",
              dbSelectKey,
              () => setDbSelectKey((k) => k + 1),
            )}
          </div>

          <div className="space-y-2">
            <div>
              <p className="text-xs font-medium text-foreground">Connect to existing Application</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Select other apps this app should reach.</p>
            </div>
            {renderConnectionDropdown(
              applicationOptions,
              selectedApplications,
              "No other apps in this project yet, or they are not ready to connect.",
              "Choose an application…",
              appSelectKey,
              () => setAppSelectKey((k) => k + 1),
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-muted/25 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-foreground">Optional: extra overlay networks</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Each name adds another Docker overlay network to this stack’s Compose file so this service can join
                  multiple internal networks (for example to isolate traffic). Skip this if the default network is enough.
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-primary hover:underline shrink-0"
                onClick={() => onStackKeysChange([...stackKeys, ""])}
              >
                + Add
              </button>
            </div>
            {stackKeys.map((_, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  className="input-field flex-1 text-sm"
                  placeholder="e.g. cache-net"
                  value={stackKeys[i] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const next = [...stackKeys];
                    next[i] = v;
                    onStackKeysChange(next);
                  }}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-2 py-1.5 text-xs"
                  onClick={() => onStackKeysChange(stackKeys.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          </div>
        </div>
      </details>
    </div>
  );
}
