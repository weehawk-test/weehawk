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

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("dark") ? "dark" : "light";
    }
    return "dark";
  });

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
    setThemeState(nextTheme);
    applyThemeClass(nextTheme);
    persistTheme(nextTheme);
  }, []);

  const setTheme = (nextTheme: Theme) => {
    setThemeState(nextTheme);
    persistTheme(nextTheme);
    applyThemeClass(nextTheme);
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
