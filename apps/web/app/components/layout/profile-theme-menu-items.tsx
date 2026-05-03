"use client";

import { Moon } from "lucide-react";
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/theme-context";
import { cn } from "@/lib/utils";

/**
 * Dark mode toggle inside the profile menu (switch on = dark theme).
 * Not a {@link DropdownMenuItem}: Radix closes the menu when an item is activated; a plain row avoids that flash.
 */
export function ProfileThemeMenuItems() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <>
      <DropdownMenuSeparator className="my-1 bg-border/70" />
      <div
        role="group"
        aria-label="Theme"
        className={cn(
          "relative flex select-none items-center gap-3 rounded-md px-3 py-2 text-[15px] outline-none",
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Moon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 text-sm font-medium">Dark mode</span>
        </span>
        <Switch
          checked={isDark}
          onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        />
      </div>
    </>
  );
}
