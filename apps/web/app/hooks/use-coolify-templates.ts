"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCoolifyServiceTemplates, type CoolifyServiceTemplate } from "@/lib/coolify-templates";

export function useCoolifyTemplates(enabled = true) {
  return useQuery<CoolifyServiceTemplate[], Error>({
    queryKey: ["coolify", "service-templates"],
    queryFn: fetchCoolifyServiceTemplates,
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: 2,
  });
}
