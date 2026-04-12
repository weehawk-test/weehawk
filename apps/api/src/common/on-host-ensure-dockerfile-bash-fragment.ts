import {
  goDistrolessDockerfile,
  nodeMultiStageDockerfile,
  pythonAlpineDockerfile,
  springBootGradleDockerfile,
  springBootMavenDockerfile,
  staticNginxDockerfile,
} from '../dockerfile-generator/dockerfile-templates';

/** Unlikely to appear in generated Dockerfile bodies; replaced with __WEHAWK_PORT__ then ${P} on the host. */
const MAGIC_PORT = 31337;

function withPortPlaceholder(get: (port: number) => string): string {
  return get(MAGIC_PORT).replace(new RegExp(String(MAGIC_PORT), 'g'), '__WEHAWK_PORT__');
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

/**
 * Bash helpers inlined into {@link buildOnHostRedeployScriptBody}: if the build context has no
 * Dockerfile, generate one the same way as {@link DockerfileGeneratorService.ensureDockerfileForContext}
 * (stack detection + templates), then `docker build` can run on hosts without the Weehawk API.
 */
export function buildEnsureDockerfileBashFragment(): string {
  const tpl = {
    nodeNext: b64(withPortPlaceholder((n) => nodeMultiStageDockerfile({ port: n, variant: 'next' }))),
    nodeGeneric: b64(
      withPortPlaceholder((n) => nodeMultiStageDockerfile({ port: n, variant: 'generic' })),
    ),
    go: b64(withPortPlaceholder((n) => goDistrolessDockerfile({ port: n }))),
    python: b64(withPortPlaceholder((n) => pythonAlpineDockerfile({ port: n }))),
    static: b64(staticNginxDockerfile()),
    springMaven: b64(withPortPlaceholder((n) => springBootMavenDockerfile({ port: n }))),
    springGradle: b64(withPortPlaceholder((n) => springBootGradleDockerfile({ port: n }))),
  };

  return `
# ─── Weehawk: generate Dockerfile when repo has none (parity with API DockerfileGenerator) ───
_WH_B64_NODE_NEXT=${shSingleQuoteForBashExport(tpl.nodeNext)}
_WH_B64_NODE_GEN=${shSingleQuoteForBashExport(tpl.nodeGeneric)}
_WH_B64_GO=${shSingleQuoteForBashExport(tpl.go)}
_WH_B64_PY=${shSingleQuoteForBashExport(tpl.python)}
_WH_B64_STATIC=${shSingleQuoteForBashExport(tpl.static)}
_WH_B64_SB_MVN=${shSingleQuoteForBashExport(tpl.springMaven)}
_WH_B64_SB_GRD=${shSingleQuoteForBashExport(tpl.springGradle)}

weehawk_emit_dockerfile_from_b64() {
  local out="\$1" b64="\$2" p="\$3"
  printf '%s' "\$b64" | base64 -d | sed "s/__WEHAWK_PORT__/\$p/g" > "\$out"
}

weehawk_is_spring_boot_pom() {
  [ -f "\$1/pom.xml" ] && grep -qE 'spring-boot-starter-parent|spring-boot-maven-plugin|spring-boot\\.version|org\\.springframework\\.boot' "\$1/pom.xml"
}

weehawk_is_spring_boot_gradle() {
  local f
  for f in "\$1/build.gradle" "\$1/build.gradle.kts"; do
    [ -f "\$f" ] || continue
    if grep -qE 'org\\.springframework\\.boot|spring-boot-starter|spring-boot-gradle-plugin|spring-boot\\.plugins' "\$f"; then
      return 0
    fi
  done
  return 1
}

weehawk_has_user_dockerfile_at_context_root() {
  local d="\$1"
  [ -f "\$d/Dockerfile" ] && return 0
  local g
  for g in "\$d"/[Dd]ockerfile*; do
    [ -f "\$g" ] && return 0
  done
  return 1
}

# If no Dockerfile at context root, detect stack and write Dockerfile (same order as dockerfile-detector).
weehawk_ensure_generated_dockerfile_in_context() {
  local CTX="\$1"
  local DF_REL="\${2:-Dockerfile}"
  local P="\${WEEHAWK_APP_CONTAINER_PORT:-3000}"
  [ -d "\$CTX" ] || return 0
  if [ -f "\$CTX/\$DF_REL" ] || weehawk_has_user_dockerfile_at_context_root "\$CTX"; then
    return 0
  fi
  echo "=== Weehawk: generating Dockerfile (no Dockerfile in build context) ==="
  local out="\$CTX/Dockerfile"
  if [ -f "\$CTX/package.json" ]; then
    if grep -qE '"next"[[:space:]]*:[[:space:]]*"' "\$CTX/package.json" 2>/dev/null; then
      weehawk_emit_dockerfile_from_b64 "\$out" "\$_WH_B64_NODE_NEXT" "\$P"
    else
      weehawk_emit_dockerfile_from_b64 "\$out" "\$_WH_B64_NODE_GEN" "\$P"
    fi
    return 0
  fi
  if [ -f "\$CTX/go.mod" ]; then
    weehawk_emit_dockerfile_from_b64 "\$out" "\$_WH_B64_GO" "\$P"
    return 0
  fi
  if weehawk_is_spring_boot_pom "\$CTX"; then
    weehawk_emit_dockerfile_from_b64 "\$out" "\$_WH_B64_SB_MVN" "\$P"
    return 0
  fi
  if weehawk_is_spring_boot_gradle "\$CTX"; then
    weehawk_emit_dockerfile_from_b64 "\$out" "\$_WH_B64_SB_GRD" "\$P"
    return 0
  fi
  if [ -f "\$CTX/requirements.txt" ] || [ -f "\$CTX/pyproject.toml" ]; then
    weehawk_emit_dockerfile_from_b64 "\$out" "\$_WH_B64_PY" "\$P"
    return 0
  fi
  if [ -f "\$CTX/index.html" ]; then
    printf '%s' "\$_WH_B64_STATIC" | base64 -d > "\$out"
    return 0
  fi
  echo "ERROR: No Dockerfile and could not detect a supported stack (Node, Go, Spring Boot, Python, static)." >&2
  echo "Add a Dockerfile to the repository or include package.json, go.mod, etc." >&2
  return 1
}
`;
}

/** Single-quoted string safe for bash assignment of base64 (no single quotes in base64). */
function shSingleQuoteForBashExport(s: string): string {
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}
