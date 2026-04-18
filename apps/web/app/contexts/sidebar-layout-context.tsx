"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "weehawk-sidebar-collapsed";

/** Tailwind `md` — overlay nav below this width so main content stays full width. */
const MOBILE_SIDEBAR_QUERY = "(max-width: 767px)";

function subscribeMobileSidebarMq(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_SIDEBAR_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getMobileSidebarSnapshot() {
  return window.matchMedia(MOBILE_SIDEBAR_QUERY).matches;
}

function getMobileSidebarServerSnapshot() {
  return false;
}

type SidebarLayoutContextValue = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  /** Viewport uses the slide-over drawer instead of a persistent rail. */
  isMobileNav: boolean;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  openMobileNav: () => void;
  closeMobileNav: () => void;
};

const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(null);

export function SidebarLayoutProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mobileNavOpen, setMobileNavOpenState] = useState(false);

  const isMobileNav = useSyncExternalStore(
    subscribeMobileSidebarMq,
    getMobileSidebarSnapshot,
    getMobileSidebarServerSnapshot,
  );

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsedState(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const width = isMobileNav ? "0px" : collapsed ? "4rem" : "16rem";
    document.documentElement.style.setProperty("--app-sidebar-width", width);
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed, isMobileNav]);

  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), []);
  const toggle = useCallback(() => setCollapsedState((c) => !c), []);

  const setMobileNavOpen = useCallback((v: boolean) => setMobileNavOpenState(v), []);
  const openMobileNav = useCallback(() => setMobileNavOpenState(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpenState(false), []);

  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      toggle,
      isMobileNav,
      mobileNavOpen,
      setMobileNavOpen,
      openMobileNav,
      closeMobileNav,
    }),
    [
      collapsed,
      setCollapsed,
      toggle,
      isMobileNav,
      mobileNavOpen,
      setMobileNavOpen,
      openMobileNav,
      closeMobileNav,
    ],
  );

  return (
    <SidebarLayoutContext.Provider value={value}>{children}</SidebarLayoutContext.Provider>
  );
}

export function useSidebarLayout(): SidebarLayoutContextValue {
  const ctx = useContext(SidebarLayoutContext);
  if (!ctx) throw new Error("useSidebarLayout must be used within SidebarLayoutProvider");
  return ctx;
}
