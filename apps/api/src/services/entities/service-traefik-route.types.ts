/** Mirrors {@link ServiceTraefikRouteDto} / DB JSON. */
export type ServiceTraefikRoute = {
  router: string;
  hosts: string[];
  pathPrefix?: string | null;
  port?: number | null;
};
