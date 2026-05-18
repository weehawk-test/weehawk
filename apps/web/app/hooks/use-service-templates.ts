"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchServiceTemplateCatalog,
  type ServiceTemplateCatalogEntry,
} from "@/lib/service-template-catalog";

export function useServiceTemplates(enabled = true) {
  return useQuery<ServiceTemplateCatalogEntry[], Error>({
    queryKey: ["service-templates", "catalog"],
    queryFn: fetchServiceTemplateCatalog,
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: 2,
  });
}
