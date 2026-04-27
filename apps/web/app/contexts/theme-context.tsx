"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
};

const THEME_STORAGE_KEY = "weehawk-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function persistTheme(theme: Theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.cookie = `${THEME_STORAGE_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

function applyThemeWithoutMotion(theme: Theme) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyThemeClass(theme);
  // Force style recalculation while transitions are disabled.
  void root.offsetHeight;
  window.setTimeout(() => {
    root.classList.remove("theme-switching");
  }, 120);
}

export function ThemeProvider({
  children,
  initialTheme = "dark",
}: {
  children: ReactNode;
  initialTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_STORAGE_KEY) ?? "").trim();
    const nextTheme: Theme =
      stored === "light"
        ? "light"
        : stored === "dark"
          ? "dark"
          : document.documentElement.classList.contains("dark")
            ? "dark"
            : "light";
    if (nextTheme !== theme) setThemeState(nextTheme);
    applyThemeWithoutMotion(nextTheme);
    persistTheme(nextTheme);
  }, [theme]);

  const setTheme = (nextTheme: Theme) => {
    setThemeState(nextTheme);
    persistTheme(nextTheme);
    applyThemeWithoutMotion(nextTheme);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme: theme,
      setTheme,
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
