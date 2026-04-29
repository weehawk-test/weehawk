/**
 * Bash fragment: if `_GH_APP`, `_GH_INST`, and `_GH_PEM` (PEM as base64, no newline) are set,
 * exchange a GitHub App JWT for an installation access token and prefix {@link urlVarName} with
 * `https://x-access-token:<token>@` (same behavior as Git credential embedding for `git clone`).
 *
 * Used on the deploy/build host by the webhook redeploy script and by {@link ExecutorService}
 * SSH clone steps so private GitHub repos work without an interactive credential prompt.
 */
export function bashGithubInstallationTokenMutateUrl(
  urlVarName: string,
  logLabel: string,
): string {
  const U = urlVarName;
  return `  if [ -n "\$_GH_APP" ] && [ -n "\$_GH_INST" ] && [ -n "\$_GH_PEM" ]; then
    echo "=== ${logLabel}: generating GitHub installation token ==="
    _KF=\$(mktemp)
    printf '%s' "\$_GH_PEM" | base64 -d > "\$_KF" 2>/dev/null
    _NOW=\$(date +%s)
    _HDR=\$(printf '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e | tr -d '=\\n' | tr '/+' '_-')
    _PLD=\$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' \$((_NOW-60)) \$((_NOW+300)) "\$_GH_APP" | openssl base64 -e | tr -d '=\\n' | tr '/+' '_-')
    _SIG=\$(printf '%s' "\$_HDR.\$_PLD" | openssl dgst -sha256 -sign "\$_KF" | openssl base64 -e | tr -d '=\\n' | tr '/+' '_-')
    _JWT="\$_HDR.\$_PLD.\$_SIG"
    rm -f "\$_KF"
    _TR=\$(curl -sS -X POST \\
      -H "Authorization: Bearer \$_JWT" \\
      -H "Accept: application/vnd.github+json" \\
      "https://api.github.com/app/installations/\$_GH_INST/access_tokens" 2>&1)
    _GH_TOK=\$(printf '%s' "\$_TR" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -1)
    if [ -n "\$_GH_TOK" ]; then
      ${U}=\$(printf '%s' "\$${U}" | sed "s|https://|https://x-access-token:\${_GH_TOK}@|")
      echo "=== ${logLabel}: GitHub token OK ==="
    else
      echo "ERROR: Could not get GitHub installation token." >&2
      echo "Response: \$_TR" >&2
      exit 1
    fi
  fi`;
}
