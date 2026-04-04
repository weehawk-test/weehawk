/** Fixed external overlay Traefik and app stacks attach to (not user-configurable). */
export const WEEHAWK_TRAEFIK_EXTERNAL_NETWORK = 'weehawk';

/** Host directory mounted at /etc/traefik/dynamic for platform UI routing YAML. */
export const WEEHAWK_TRAEFIK_DYNAMIC_HOST_PATH = '/var/www/weehawk/traefik/dynamic';

/** Weehawk web (Next.js) on the Traefik host — file-provider backend URL. */
export const WEEHAWK_PLATFORM_UI_HOST_PORT = 3000;
