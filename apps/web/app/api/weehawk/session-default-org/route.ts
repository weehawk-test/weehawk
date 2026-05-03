import { NextResponse } from "next/server";
import { fetchOrganizationsListSSR } from "@/lib/server-fetch";
import { pickDefaultWorkspaceOrganization } from "@/lib/pick-primary-owned-org";

export const dynamic = "force-dynamic";

/**
 * Resolves the signed-in user’s default organization id using the same cookie → API
 * forwarding as SSR. Used by middleware (same-origin fetch) because Edge middleware
 * cannot reliably reach the API host (e.g. localhost:8080) in all dev/prod setups.
 */
export async function GET() {
  const orgs = await fetchOrganizationsListSSR();
  const d = pickDefaultWorkspaceOrganization(orgs);
  const publicId = d?.publicId?.trim() ?? "";
  return NextResponse.json({ publicId: publicId || null });
}
