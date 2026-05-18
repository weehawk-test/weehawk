"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutTemplate,
  Loader2,
  Search,
  X,
} from "lucide-react";
import {
  templateCatalogCategories,
  templateCatalogLogoUrl,
  type ServiceTemplateCatalogEntry,
} from "@/lib/service-template-catalog";
import { useServiceTemplates } from "@/hooks/use-service-templates";
import { cn } from "@/lib/utils";

const WEEHAWK_TEMPLATES_REPO = "https://github.com/weehawkio/weehawk-templates";

type ServiceTemplatePickerProps = {
  open: boolean;
  selectedId?: string;
  onSelect: (template: ServiceTemplateCatalogEntry) => void;
  onCancel: () => void;
};

function formatCategoryLabel(cat: string): string {
  return cat.replace(/-/g, " ");
}

export function ServiceTemplatePicker({
  open,
  selectedId,
  onSelect,
  onCancel,
}: ServiceTemplatePickerProps) {
  const { data: templates = [], isLoading, isError, error, refetch } =
    useServiceTemplates(open);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | "all">("all");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setCategory("all");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const categories = useMemo(() => templateCatalogCategories(templates), [templates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (category !== "all" && (t.category ?? "") !== category) return false;
      if (!q) return true;
      const hay = [t.id, t.displayName, t.slogan, t.category ?? "", ...(t.tags ?? [])]
        .join(" ")
        .toLowerCase();
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
          className="modal-scrim fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="glass-panel relative flex h-[min(92vh,840px)] max-h-[min(92vh,840px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-amber-500/20 blur-3xl dark:bg-amber-400/10"
            />
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -bottom-24 -left-12 h-48 w-48 rounded-full bg-primary/15 blur-3xl"
            />

            <header className="relative z-10 shrink-0 border-b border-border/60 px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 }}
                className="flex items-start justify-between gap-4"
              >
                <div className="flex min-w-0 items-start gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-700 shadow-sm dark:text-amber-200">
                    <LayoutTemplate className="h-5 w-5" aria-hidden />
                  </span>
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06 }}
                    className="min-w-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h2
                        id="template-picker-title"
                        className="text-lg font-semibold tracking-tight text-foreground sm:text-xl"
                      >
                        Choose a template
                      </h2>
                      {!isLoading && !isError && templates.length > 0 && (
                        <span className="rounded-full border border-border/80 bg-muted/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                          {templates.length} stacks
                        </span>
                      )}
                    </div>
                    <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                      Curated Docker Compose stacks from the Weehawk catalog. Pick one, then configure env vars before
                      deploy.
                    </p>
                  </motion.div>
                </div>
                <button
                  type="button"
                  onClick={onCancel}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="relative mt-4"
              >
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, category, or tag…"
                  className="input-field w-full rounded-xl border-border/80 bg-background/50 py-2.5 !px-0 !pl-11 !pr-10 text-sm"
                  autoComplete="off"
                  autoFocus
                />
                {query.trim() !== "" && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </motion.div>

              {categories.length > 0 && (
                <CategoryRail
                  categories={categories}
                  category={category}
                  onCategoryChange={setCategory}
                />
              )}
            </header>

            <motion.div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
              {isLoading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 py-12 text-muted-foreground"
                >
                  <Loader2 className="h-8 w-8 animate-spin text-amber-600/80 dark:text-amber-400/80" />
                  <p className="text-sm">Loading template catalog…</p>
                </motion.div>
              )}

              {isError && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex min-h-full flex-1 flex-col items-center justify-center p-4"
                >
                  <div className="w-full max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                  <p className="text-sm text-destructive">{error?.message ?? "Failed to load templates"}</p>
                  <button type="button" onClick={() => void refetch()} className="btn-secondary mt-4 text-xs">
                    Retry
                  </button>
                  </div>
                </motion.div>
              )}

              {!isLoading && !isError && filtered.length === 0 && (
                <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                  <p className="text-sm font-medium text-foreground">No templates match</p>
                  <p className="max-w-sm text-xs text-muted-foreground">
                    Try another search term or category, or clear filters to browse the full catalog.
                  </p>
                  {(query.trim() !== "" || category !== "all") && (
                    <button
                      type="button"
                      className="btn-secondary mt-2 text-xs"
                      onClick={() => {
                        setQuery("");
                        setCategory("all");
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}

              {!isLoading && !isError && filtered.length > 0 && (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((tpl, index) => (
                    <TemplateCard
                      key={tpl.id}
                      tpl={tpl}
                      active={selectedId === tpl.id}
                      index={index}
                      onSelect={() => onSelect(tpl)}
                    />
                  ))}
                </ul>
              )}
            </motion.div>

            <footer className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-muted/20 px-5 py-3 sm:px-6">
              <p className="text-xs text-muted-foreground">
                {!isLoading && !isError && (
                  <>
                    Showing{" "}
                    <span className="font-medium tabular-nums text-foreground">{filtered.length}</span>
                    {filtered.length !== templates.length && (
                      <>
                        {" "}
                        of <span className="tabular-nums">{templates.length}</span>
                      </>
                    )}{" "}
                    templates
                  </>
                )}
              </p>
              <a
                href={WEEHAWK_TEMPLATES_REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Browse catalog on GitHub
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CategoryRail({
  categories,
  category,
  onCategoryChange,
}: {
  categories: string[];
  category: string | "all";
  onCategoryChange: (value: string | "all") => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  const updateScrollHints = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setHasOverflow(maxScroll > 4);
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(maxScroll > 4 && el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    updateScrollHints();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollHints, { passive: true });
    const observer = new ResizeObserver(updateScrollHints);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollHints);
      observer.disconnect();
    };
  }, [categories, updateScrollHints]);

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  const scrollButtonClass = (enabled: boolean) =>
    cn(
      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-zinc-900/70 text-white shadow-sm transition-colors dark:bg-zinc-950/80",
      enabled
        ? "hover:border-amber-500/35 hover:bg-zinc-800"
        : "cursor-not-allowed opacity-40",
    );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="z-10 mt-3"
    >
      <div className={cn("flex items-center", hasOverflow ? "gap-2.5" : "gap-1")}>
        {hasOverflow && (
          <button
            type="button"
            onClick={() => scrollBy(-220)}
            disabled={!canScrollLeft}
            className={scrollButtonClass(canScrollLeft)}
            aria-label="Scroll categories left"
          >
            <ChevronLeft className="h-4 w-4 text-white" aria-hidden />
          </button>
        )}

        <div
          ref={scrollRef}
          className={cn(
            "flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden py-0.5",
            "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "[-webkit-overflow-scrolling:touch] snap-x snap-mandatory",
            "px-1",
          )}
        >
          <CategoryPill
            active={category === "all"}
            onClick={() => onCategoryChange("all")}
            label="All"
            className={cn("snap-start", hasOverflow && "ml-0.5")}
          />
          {categories.map((cat) => (
            <CategoryPill
              key={cat}
              active={category === cat}
              onClick={() => onCategoryChange(cat)}
              label={formatCategoryLabel(cat)}
              className="snap-start"
            />
          ))}
        </div>

        {hasOverflow && (
          <button
            type="button"
            onClick={() => scrollBy(220)}
            disabled={!canScrollRight}
            className={scrollButtonClass(canScrollRight)}
            aria-label="Scroll categories right"
          >
            <ChevronRight className="h-4 w-4 text-white" aria-hidden />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function CategoryPill({
  active,
  label,
  onClick,
  className,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium capitalize transition-all",
        className,
        active
          ? "border-amber-500/40 bg-amber-500/15 text-amber-950 shadow-sm dark:text-amber-100"
          : "border-border/80 bg-background/40 text-muted-foreground hover:border-amber-500/25 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function TemplateCard({
  tpl,
  active,
  index,
  onSelect,
}: {
  tpl: ServiceTemplateCatalogEntry;
  active: boolean;
  index: number;
  onSelect: () => void;
}) {
  const tagPreview = (tpl.tags ?? []).slice(0, 2);

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.24), duration: 0.22 }}
      className="h-full list-none"
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "group relative flex h-full min-h-[9.5rem] w-full flex-col rounded-xl border p-4 text-left transition-all duration-200",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          active
            ? "border-amber-500/50 bg-amber-500/10 shadow-md shadow-amber-500/10 ring-1 ring-amber-500/25"
            : "border-border/80 bg-card/50 hover:-translate-y-0.5 hover:border-amber-500/30 hover:bg-muted/40 hover:shadow-lg hover:shadow-amber-500/5",
        )}
      >
        {active && (
          <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-amber-950 shadow-sm dark:text-amber-950">
            <Check className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden />
          </span>
        )}

        <span className="flex items-start gap-3">
          <span className="template-catalog-logo-tile template-catalog-logo-tile--md">
            <Image
              src={templateCatalogLogoUrl(tpl.logo, tpl.id)}
              alt=""
              width={44}
              height={44}
              className="template-catalog-logo-img max-h-10 max-w-10"
              sizes="44px"
              unoptimized
            />
          </span>
          <span className="min-w-0 flex-1 pr-6">
            <span className="font-semibold text-foreground block truncate leading-snug">{tpl.displayName}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              {tpl.category && (
                <span className="inline-flex rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                  {formatCategoryLabel(tpl.category)}
                </span>
              )}
              {tpl.port && (
                <span className="inline-flex rounded-md border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  :{tpl.port}
                </span>
              )}
            </span>
          </span>
        </span>

        <span className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{tpl.slogan}</span>

        {tagPreview.length > 0 && (
          <span className="mt-auto flex flex-wrap gap-1 pt-3">
            {tagPreview.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
      </button>
    </motion.li>
  );
}
