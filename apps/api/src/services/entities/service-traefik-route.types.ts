/** Mirrors {@link ServiceTraefikRouteDto} / DB JSON. */
export type ServiceTraefikRoute = {
  router: string;
  hosts: string[];
  pathPrefix?: string | null;
  port?: number | null;
  /** When false, Traefik uses HTTP entrypoint only (no TLS label). Default true. */
  https?: boolean;
};
