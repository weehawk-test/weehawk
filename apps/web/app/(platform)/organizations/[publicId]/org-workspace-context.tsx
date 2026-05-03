"use client";

import { createContext, useContext } from "react";
import type { OrganizationPublic } from "@/lib/organizations-types";

const OrgWorkspaceContext = createContext<OrganizationPublic | null>(null);

export function OrgWorkspaceProvider({
  org,
  children,
}: {
  org: OrganizationPublic;
  children: React.ReactNode;
}) {
  return <OrgWorkspaceContext.Provider value={org}>{children}</OrgWorkspaceContext.Provider>;
}

export function useOrgWorkspace(): OrganizationPublic {
  const v = useContext(OrgWorkspaceContext);
  if (!v) {
    throw new Error("useOrgWorkspace must be used inside an organization layout");
  }
  return v;
}

/** Same context as {@link useOrgWorkspace} but returns null on personal account routes. */
export function useOptionalOrgWorkspace(): OrganizationPublic | null {
  return useContext(OrgWorkspaceContext);
}
