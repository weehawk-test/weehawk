"use client";

import { useMemo, useState } from "react";
import type { OrganizationAuditLogEntry } from "@/ee/audit/types";
import {
  organizationAuditActionLabel,
  organizationAuditEndpoint,
  organizationAuditHttpStatus,
  organizationAuditTargetSummary,
} from "@/ee/audit/organization-audit-log-labels";

/** Compact defaults; drag handles still expand any column. */
const DEFAULT_WIDTHS = [118, 128, 148, 198, 56, 124] as const;
const MIN_WIDTHS = [96, 104, 112, 128, 48, 88] as const;

const HEADERS = ["When", "Actor", "Event", "API", "HTTP", "Target"] as const;

type Props = {
  entries: OrganizationAuditLogEntry[];
};

export function OrganizationAuditResizableTable({ entries }: Props) {
  const [widths, setWidths] = useState<number[]>([...DEFAULT_WIDTHS]);

  const totalMinWidth = useMemo(
    () => widths.reduce((sum, w) => sum + w, 0),
    [widths],
  );

  const beginResize = (index: number, startX: number) => {
    const start = [...widths];
    const onMove = (event: MouseEvent) => {
      const dx = event.clientX - startX;
      const next = [...start];
      next[index] = Math.max(MIN_WIDTHS[index], start[index] + dx);
      setWidths(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-sm"
        style={{ minWidth: `${totalMinWidth}px`, tableLayout: "fixed" }}
      >
        <colgroup>
          {widths.map((w, idx) => (
            <col key={HEADERS[idx]} style={{ width: `${w}px` }} />
          ))}
        </colgroup>
        <thead className="border-b border-border/60 bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            {HEADERS.map((header, idx) => (
              <th key={header} className="group relative px-4 py-3">
                <span className={header === "HTTP" ? "whitespace-nowrap" : undefined}>
                  {header}
                </span>
                {idx < HEADERS.length - 1 ? (
                  <button
                    type="button"
                    aria-label={`Resize ${header} column`}
                    onMouseDown={(event) => beginResize(idx, event.clientX)}
                    className="absolute right-0 top-0 z-10 h-full w-2.5 cursor-col-resize border-r border-border/55 bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border/50"
                  />
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {entries.map((e) => (
            <tr key={e.id} className="hover:bg-muted/20">
              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                <time dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </td>
              <td className="truncate px-4 py-3 font-mono text-xs text-foreground">{e.actorEmail}</td>
              <td className="truncate px-4 py-3 text-foreground">{organizationAuditActionLabel(e.action)}</td>
              <td className="truncate px-4 py-3 font-mono text-[11px] text-muted-foreground">
                {organizationAuditEndpoint(e.metadata)}
              </td>
              <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                {organizationAuditHttpStatus(e.metadata)}
              </td>
              <td className="truncate px-4 py-3 font-mono text-xs text-muted-foreground">
                {organizationAuditTargetSummary(e.metadata)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
