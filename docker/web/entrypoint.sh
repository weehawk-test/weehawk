#!/bin/sh
set -eu

# Escape characters that are special on the RHS of sed s||| (BusyBox/GNU).
escape_for_sed_replacement() {
  printf '%s' "$1" | sed 's/\\/\\\\/g;s/&/\\&/g'
}

NEXT_DIR="apps/web/.next"
if [ -d "$NEXT_DIR" ]; then
  API_ESC=$(escape_for_sed_replacement "${NEXT_PUBLIC_API_URL:-}")
  MODE_ESC=$(escape_for_sed_replacement "${NEXT_PUBLIC_INSTANCE_MODE:-}")
  # Longer pattern first: next.config rewrites use `http://__WEEHAWK_RUNTIME_API_URL__` at build time.
  find "$NEXT_DIR" -type f \( -name "*.js" -o -name "*.html" \) -exec sed -i \
    -e "s|http://__WEEHAWK_RUNTIME_API_URL__|${API_ESC}|g" \
    -e "s|__WEEHAWK_RUNTIME_API_URL__|${API_ESC}|g" \
    -e "s|__WEEHAWK_RUNTIME_INSTANCE_MODE__|${MODE_ESC}|g" \
    {} +
fi

exec "$@"
