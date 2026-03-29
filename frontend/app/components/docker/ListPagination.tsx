"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ListPaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  from: number;
  to: number;
  total: number;
  className?: string;
};

export function ListPagination({
  page,
  totalPages,
  onPageChange,
  from,
  to,
  total,
  className,
}: ListPaginationProps) {
  if (total === 0 || totalPages <= 1) return null;
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-white/5 text-sm text-muted-foreground",
        className,
      )}
    >
      <p>
        Showing <span className="text-foreground font-medium tabular-nums">{from}</span>–
        <span className="text-foreground font-medium tabular-nums">{to}</span> of{" "}
        <span className="text-foreground font-medium tabular-nums">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="btn-secondary text-xs py-1.5 h-8 px-2.5 flex items-center gap-1 disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </button>
        <span className="text-xs tabular-nums px-2">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="btn-secondary text-xs py-1.5 h-8 px-2.5 flex items-center gap-1 disabled:opacity-40"
          aria-label="Next page"
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
