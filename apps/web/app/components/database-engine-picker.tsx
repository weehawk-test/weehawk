"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { DATABASE_ENGINES, databaseLogoBlendClass, type DatabaseEngineId } from "@/lib/database-engines";

type DatabaseEnginePickerProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
  selectedId?: DatabaseEngineId;
  onSelect: (id: DatabaseEngineId) => void;
  onCancel: () => void;
};

export function DatabaseEnginePicker({
  open,
  title = "Choose a database",
  subtitle = "Pick the engine for this service. You can change it later from the service page.",
  selectedId,
  onSelect,
  onCancel,
}: DatabaseEnginePickerProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="db-picker-title"
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
            className="relative flex max-h-[min(90vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 pb-4 pt-6">
              <div>
                <h2 id="db-picker-title" className="text-xl font-semibold tracking-tight text-foreground">
                  {title}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
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

            <div className="overflow-y-auto px-6 py-5 flex-1 min-h-0">
              <ul className="grid gap-3 sm:grid-cols-2">
                {DATABASE_ENGINES.map((eng) => {
                  const active = selectedId === eng.id;
                  return (
                    <li key={eng.id} className="h-full">
                      <button
                        type="button"
                        onClick={() => onSelect(eng.id)}
                        className={`flex h-[8.5rem] w-full items-start gap-4 rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 ${
                          active
                            ? "border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/20 dark:bg-sky-500/15"
                            : "border-border bg-muted/50 hover:border-sky-500/40 hover:bg-muted"
                        }`}
                      >
                        <span className="relative h-14 w-28 shrink-0 flex items-center justify-center">
                          <Image
                            src={eng.logoSrc}
                            alt=""
                            width={112}
                            height={56}
                            className={`object-contain max-h-12 w-auto max-w-[7rem] ${databaseLogoBlendClass(eng.id)}`}
                            sizes="112px"
                          />
                        </span>
                        <span className="min-w-0 flex-1 overflow-hidden">
                          <span className="font-medium text-foreground block truncate">{eng.name}</span>
                          <span className="text-xs text-muted-foreground mt-1 leading-relaxed block h-10 overflow-hidden">
                            {eng.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
