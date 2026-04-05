import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer h-4 w-4 shrink-0 rounded-[4px] shadow-none filter-none",
      "border border-zinc-300 bg-white text-foreground",
      "dark:border-zinc-500/70 dark:bg-zinc-800/95 dark:text-zinc-100",
      "hover:border-zinc-400 hover:bg-zinc-50",
      "dark:hover:border-zinc-400/80 dark:hover:bg-zinc-700/95",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      /** Tinted fill + colored mark — avoids a full primary “invert” vs unchecked */
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary",
      "dark:data-[state=checked]:bg-primary/15",
      "data-[state=indeterminate]:border-primary/80 data-[state=indeterminate]:bg-primary/10 data-[state=indeterminate]:text-primary",
      "dark:data-[state=indeterminate]:bg-primary/15",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("grid place-content-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
