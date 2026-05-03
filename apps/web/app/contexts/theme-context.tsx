"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
};

const THEME_STORAGE_KEY = "weehawk-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readThemeFromClientStorage(fallback: Theme): Theme {
  if (typeof window === "undefined") return fallback;
  const stored = (localStorage.getItem(THEME_STORAGE_KEY) ?? "").trim();
  if (stored === "light") return "light";
  if (stored === "dark") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function persistTheme(theme: Theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  document.cookie = `${THEME_STORAGE_KEY}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function applyThemeClass(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({
  children,
  initialTheme = "dark",
}: {
  children: ReactNode;
  initialTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(() => readThemeFromClientStorage(initialTheme));

  /** Sync `<html>` + cookie on mount (state already matches from lazy `useState`). */
  useEffect(() => {
    applyThemeClass(theme);
    persistTheme(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: `theme` is the first-render value from lazy `useState`
  }, []);

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme);
    persistTheme(nextTheme);
    applyThemeClass(nextTheme);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme: theme,
      setTheme,
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
