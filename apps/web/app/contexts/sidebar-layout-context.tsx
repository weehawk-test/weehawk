"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "weehawk-sidebar-collapsed";
const COOKIE_KEY = "weehawk-sidebar-collapsed";
const MOBILE_OPEN_STORAGE_KEY = "weehawk-sidebar-mobile-open";
const MOBILE_OPEN_COOKIE_KEY = "weehawk-sidebar-mobile-open";

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

export function SidebarLayoutProvider({
  children,
  initialCollapsed = false,
  initialMobileNavOpen = false,
}: {
  children: React.ReactNode;
  initialCollapsed?: boolean;
  initialMobileNavOpen?: boolean;
}) {
  const [collapsed, setCollapsedState] = useState(initialCollapsed);
  const [mobileNavOpen, setMobileNavOpenState] = useState(initialMobileNavOpen);

  const isMobileNav = useSyncExternalStore(
    subscribeMobileSidebarMq,
    getMobileSidebarSnapshot,
    getMobileSidebarServerSnapshot,
  );

  useLayoutEffect(() => {
    const width = isMobileNav ? "0px" : collapsed ? "4rem" : "16rem";
    document.documentElement.style.setProperty("--app-sidebar-width", width);
  }, [collapsed, isMobileNav]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
      document.cookie = `${COOKIE_KEY}=${collapsed ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(MOBILE_OPEN_STORAGE_KEY, mobileNavOpen ? "1" : "0");
      document.cookie = `${MOBILE_OPEN_COOKIE_KEY}=${mobileNavOpen ? "1" : "0"}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!isMobileNav && mobileNavOpen) {
      setMobileNavOpenState(false);
    }
  }, [isMobileNav, mobileNavOpen]);

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
