"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Checkboxes for Docker bulk actions — dark surface, no native white box. */
const bulkStyles = cn(
  "h-4 w-4 shrink-0 rounded-[4px] shadow-none",
  "border border-zinc-500/55 bg-zinc-950/85 text-zinc-100",
  "hover:border-zinc-400/65 hover:bg-zinc-900/90",
  "focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
  "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
  "data-[state=indeterminate]:border-primary/75 data-[state=indeterminate]:bg-primary/20 data-[state=indeterminate]:text-primary",
  "disabled:opacity-50",
);

export const DockerBulkCheckbox = React.forwardRef<
  React.ElementRef<typeof Checkbox>,
  React.ComponentPropsWithoutRef<typeof Checkbox>
>(({ className, ...props }, ref) => (
  <Checkbox ref={ref} className={cn(bulkStyles, className)} {...props} />
));
DockerBulkCheckbox.displayName = "DockerBulkCheckbox";
