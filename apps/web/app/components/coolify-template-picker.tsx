"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Search, X } from "lucide-react";
import {
  coolifyTemplateCategories,
  coolifyTemplateLogoUrl,
  type CoolifyServiceTemplate,
} from "@/lib/coolify-templates";
import { useCoolifyTemplates } from "@/hooks/use-coolify-templates";

type CoolifyTemplatePickerProps = {
  open: boolean;
  selectedId?: string;
  onSelect: (template: CoolifyServiceTemplate) => void;
  onCancel: () => void;
};

export function CoolifyTemplatePicker({
  open,
  selectedId,
  onSelect,
  onCancel,
}: CoolifyTemplatePickerProps) {
  const { data: templates = [], isLoading, isError, error, refetch } = useCoolifyTemplates(open);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | "all">("all");

  const categories = useMemo(() => coolifyTemplateCategories(templates), [templates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== "all" && (t.category ?? "") !== category) return false;
      if (!q) return true;
      const hay = [t.id, t.displayName, t.slogan, t.category ?? "", ...(t.tags ?? [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [templates, query, category]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-picker-title"
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
            className="relative flex max-h-[min(92vh,820px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 flex-col gap-4 border-b border-border px-6 pb-4 pt-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="template-picker-title" className="text-xl font-semibold tracking-tight text-foreground">
                    Choose a template
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    One-click stacks from{" "}
                    <a
                      href="https://github.com/coollabsio/coolify/tree/v4.x/templates"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      Coolify templates
                    </a>
                    . Deploy as Docker Compose.
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

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search templates…"
                  className="input-field w-full pl-9"
                  autoComplete="off"
                />
              </div>

              {categories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCategory("all")}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      category === "all"
                        ? "border-primary/45 bg-primary/10 text-foreground"
                        : "border-border bg-muted/50 text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    All
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
                        category === cat
                          ? "border-primary/45 bg-primary/10 text-foreground"
                          : "border-border bg-muted/50 text-muted-foreground hover:border-primary/30"
                      }`}
                    >
                      {cat.replace(/-/g, " ")}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {isLoading && (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm">Loading templates from GitHub…</p>
                </div>
              )}

              {isError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
                  <p className="text-sm text-destructive">{error?.message ?? "Failed to load templates"}</p>
                  <button type="button" onClick={() => void refetch()} className="btn-secondary mt-3 text-xs">
                    Retry
                  </button>
                </div>
              )}

              {!isLoading && !isError && filtered.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">No templates match your search.</p>
              )}

              {!isLoading && !isError && filtered.length > 0 && (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {filtered.map((tpl) => {
                    const active = selectedId === tpl.id;
                    return (
                      <li key={tpl.id} className="h-full">
                        <button
                          type="button"
                          onClick={() => onSelect(tpl)}
                          className={`flex h-full min-h-[8.5rem] w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                            active
                              ? "border-primary/45 bg-primary/10 ring-1 ring-primary/20"
                              : "border-border bg-muted/50 hover:border-primary/30 hover:bg-muted"
                          }`}
                        >
                          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60 p-1.5">
                            <Image
                              src={coolifyTemplateLogoUrl(tpl.logo, tpl.id)}
                              alt=""
                              width={40}
                              height={40}
                              className="object-contain max-h-9 max-w-9 dark:brightness-110"
                              sizes="40px"
                              unoptimized
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-foreground block truncate">{tpl.displayName}</span>
                            <span className="text-[11px] text-muted-foreground capitalize block mt-0.5">
                              {tpl.category?.replace(/-/g, " ") ?? "template"}
                              {tpl.port ? ` · port ${tpl.port}` : ""}
                            </span>
                            <span className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-2 block">
                              {tpl.slogan}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
