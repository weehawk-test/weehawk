import { NotificationChannelType } from '../notifications/entities/notification-channel-type.enum';
import type { NotificationChannelRuntimeConfig } from '../notifications/notification.service';

function appendRemoteNotificationProviderEnvLines(
  lines: string[],
  channel: NotificationChannelRuntimeConfig,
): void {
  const cfg = channel.config;
  switch (channel.type) {
    case NotificationChannelType.TELEGRAM:
      lines.push(
        `WEEHAWK_NOTIFY_TOKEN=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'token'))}`,
        `WEEHAWK_NOTIFY_TARGET=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'target'))}`,
      );
      break;
    case NotificationChannelType.SLACK:
    case NotificationChannelType.DISCORD:
    case NotificationChannelType.LARK:
    case NotificationChannelType.MICROSOFT_TEAMS:
      lines.push(
        `WEEHAWK_NOTIFY_WEBHOOK_URL=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'webhookUrl'))}`,
      );
      break;
    case NotificationChannelType.GOTIFY:
      lines.push(
        `WEEHAWK_NOTIFY_SERVER_URL=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'serverUrl'))}`,
        `WEEHAWK_NOTIFY_APP_TOKEN=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'appToken'))}`,
        `WEEHAWK_NOTIFY_PRIORITY=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'priority') || '5')}`,
      );
      break;
    case NotificationChannelType.NTFY:
      lines.push(
        `WEEHAWK_NOTIFY_SERVER_URL=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'serverUrl'))}`,
        `WEEHAWK_NOTIFY_TOPIC=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'topic'))}`,
        `WEEHAWK_NOTIFY_TOKEN=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'token'))}`,
      );
      break;
    case NotificationChannelType.PUSHOVER:
      lines.push(
        `WEEHAWK_NOTIFY_APP_TOKEN=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'appToken'))}`,
        `WEEHAWK_NOTIFY_USER_KEY=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'userKey'))}`,
        `WEEHAWK_NOTIFY_DEVICE=${remoteEnvFileQuote(readNotificationConfigString(cfg, 'device'))}`,
      );
      break;
    default:
      lines.length = 0;
      lines.push('WEEHAWK_NOTIFY_ENABLED=0');
      break;
  }
}

/**
 * Env lines for `send_notification` on a remote host (credentials only; message is passed as an argument).
 * Returns `WEEHAWK_NOTIFY_ENABLED=0` when the channel type is not supported for remote dispatch.
 */
export function buildRemoteNotificationCredentialEnvLines(
  channel: NotificationChannelRuntimeConfig | null,
): string[] {
  if (!channel) {
    return ['WEEHAWK_NOTIFY_ENABLED=0'];
  }
  const lines: string[] = [
    'WEEHAWK_NOTIFY_ENABLED=1',
    `WEEHAWK_NOTIFY_TYPE=${remoteEnvFileQuote(channel.type)}`,
    `WEEHAWK_NOTIFY_CHANNEL_NAME=${remoteEnvFileQuote(channel.name)}`,
  ];
  appendRemoteNotificationProviderEnvLines(lines, channel);
  return lines;
}

/** Bash-safe single-quoted path segments in remote install snippets (mkdir, chmod, heredoc targets). */
export function remoteInstallShQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Values embedded in remote `.env` files (same quoting as cron jobs). */
export function remoteEnvFileQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function readNotificationConfigString(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === 'string' ? v : '';
}

/**
 * Backward-compat: old builds stored generated multi-line cron summaries as notifyMessage.
 * If that legacy format is detected, keep only the human-entered short text.
 */
export function normalizeRemoteNotificationMessage(message: string): string {
  const trimmed = message.trim();
  const legacyLines = trimmed.split(/\r?\n/);
  if (legacyLines.length < 4) return trimmed;
  const cronJobLine = legacyLines.find((l) => l.startsWith('Cron Job:'));
  const cronLine = legacyLines.find((l) => l.startsWith('Cron:'));
  const actionLine = legacyLines.find((l) => l.startsWith('Action:'));
  const successLine = legacyLines.find((l) => l.startsWith('Success:'));
  if (cronJobLine && cronLine && actionLine && successLine) {
    const extracted = cronJobLine.replace(/^Cron Job:\s*/, '').trim();
    return extracted || trimmed;
  }
  return trimmed;
}

export function buildRemoteNotificationEnvLinesFromChannel(
  enabled: boolean,
  channel: NotificationChannelRuntimeConfig | null,
  rawNotifyMessage: string | null | undefined,
): string[] {
  if (!enabled || !channel || !rawNotifyMessage?.trim()) {
    return ['WEEHAWK_NOTIFY_ENABLED=0'];
  }
  const lines: string[] = [
    'WEEHAWK_NOTIFY_ENABLED=1',
    `WEEHAWK_NOTIFY_TYPE=${remoteEnvFileQuote(channel.type)}`,
    `WEEHAWK_NOTIFY_MESSAGE=${remoteEnvFileQuote(normalizeRemoteNotificationMessage(rawNotifyMessage))}`,
    `WEEHAWK_NOTIFY_CHANNEL_NAME=${remoteEnvFileQuote(channel.name)}`,
  ];
  appendRemoteNotificationProviderEnvLines(lines, channel);
  return lines;
}

/**
 * `json_escape` + `send_notification` for one-shot SSH dispatch (curl failures are not masked).
 */
export function remoteNotifyDispatchFunctionsBashStrict(
  channelTitleFallback: string,
): string {
  const core = [
    'json_escape() {',
    "  printf '%s' \"$1\" | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g; s/\r/\\\\r/g; s/\n/\\\\n/g'",
    '}',
    'send_notification() {',
    '  if [ "${WEEHAWK_NOTIFY_ENABLED:-0}" != "1" ]; then return 0; fi',
    '  local msg="$1"',
    '  local t="${WEEHAWK_NOTIFY_TYPE:-}"',
    '  case "$t" in',
    '    telegram)',
    '      [ -n "${WEEHAWK_NOTIFY_TOKEN:-}" ] && [ -n "${WEEHAWK_NOTIFY_TARGET:-}" ] || exit 2',
    '      curl -fsS -X POST "https://api.telegram.org/bot${WEEHAWK_NOTIFY_TOKEN}/sendMessage" --data-urlencode "chat_id=${WEEHAWK_NOTIFY_TARGET}" --data-urlencode "text=${msg}" >/dev/null',
    '      ;;',
    '    slack|microsoft-teams)',
    '      [ -n "${WEEHAWK_NOTIFY_WEBHOOK_URL:-}" ] || exit 2',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"text\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_WEBHOOK_URL}" >/dev/null',
    '      ;;',
    '    discord)',
    '      [ -n "${WEEHAWK_NOTIFY_WEBHOOK_URL:-}" ] || exit 2',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"content\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_WEBHOOK_URL}" >/dev/null',
    '      ;;',
    '    lark)',
    '      [ -n "${WEEHAWK_NOTIFY_WEBHOOK_URL:-}" ] || exit 2',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$(json_escape "$msg")\"}}" "${WEEHAWK_NOTIFY_WEBHOOK_URL}" >/dev/null',
    '      ;;',
    '    gotify)',
    '      [ -n "${WEEHAWK_NOTIFY_SERVER_URL:-}" ] && [ -n "${WEEHAWK_NOTIFY_APP_TOKEN:-}" ] || exit 2',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"title\":\"$(json_escape "${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}")\",\"message\":\"$(json_escape "$msg")\",\"priority\":${WEEHAWK_NOTIFY_PRIORITY:-5}}" "${WEEHAWK_NOTIFY_SERVER_URL%/}/message?token=${WEEHAWK_NOTIFY_APP_TOKEN}" >/dev/null',
    '      ;;',
    '    ntfy)',
    '      [ -n "${WEEHAWK_NOTIFY_SERVER_URL:-}" ] && [ -n "${WEEHAWK_NOTIFY_TOPIC:-}" ] || exit 2',
    '      if [ -n "${WEEHAWK_NOTIFY_TOKEN:-}" ]; then',
    '        curl -fsS -X POST -H "Authorization: Bearer ${WEEHAWK_NOTIFY_TOKEN}" -H "Content-Type: application/json" -d "{\"topic\":\"$(json_escape "${WEEHAWK_NOTIFY_TOPIC}")\",\"title\":\"$(json_escape "${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}")\",\"message\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_SERVER_URL%/}/${WEEHAWK_NOTIFY_TOPIC}" >/dev/null',
    '      else',
    '        curl -fsS -X POST -H "Content-Type: application/json" -d "{\"topic\":\"$(json_escape "${WEEHAWK_NOTIFY_TOPIC}")\",\"title\":\"$(json_escape "${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}")\",\"message\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_SERVER_URL%/}/${WEEHAWK_NOTIFY_TOPIC}" >/dev/null',
    '      fi',
    '      ;;',
    '    pushover)',
    '      [ -n "${WEEHAWK_NOTIFY_APP_TOKEN:-}" ] && [ -n "${WEEHAWK_NOTIFY_USER_KEY:-}" ] || exit 2',
    '      if [ -n "${WEEHAWK_NOTIFY_DEVICE:-}" ]; then',
    '        curl -fsS -X POST "https://api.pushover.net/1/messages.json" --data-urlencode "token=${WEEHAWK_NOTIFY_APP_TOKEN}" --data-urlencode "user=${WEEHAWK_NOTIFY_USER_KEY}" --data-urlencode "device=${WEEHAWK_NOTIFY_DEVICE}" --data-urlencode "title=${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}" --data-urlencode "message=${msg}" >/dev/null',
    '      else',
    '        curl -fsS -X POST "https://api.pushover.net/1/messages.json" --data-urlencode "token=${WEEHAWK_NOTIFY_APP_TOKEN}" --data-urlencode "user=${WEEHAWK_NOTIFY_USER_KEY}" --data-urlencode "title=${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}" --data-urlencode "message=${msg}" >/dev/null',
    '      fi',
    '      ;;',
    '    *)',
    '      exit 3',
    '      ;;',
    '  esac',
    '}',
  ]
    .map((line) => bashDefaultChannelTitleLines(line, channelTitleFallback))
    .join('\n');
  return core;
}

export type RemoteNotifyScriptDefaults = {
  /** e.g. Gotify / ntfy / Pushover title when `WEEHAWK_NOTIFY_CHANNEL_NAME` is unset */
  channelTitleFallback: string;
  completedMessageFallback: string;
  failedMessageFallback: string;
};

export const REMOTE_NOTIFY_DEFAULTS_CRON: RemoteNotifyScriptDefaults = {
  channelTitleFallback: 'Cron Job',
  completedMessageFallback: 'Cron job completed',
  failedMessageFallback: 'Cron job failed',
};

export const REMOTE_NOTIFY_DEFAULTS_WEBHOOK: RemoteNotifyScriptDefaults = {
  channelTitleFallback: 'Webhook',
  completedMessageFallback: 'Webhook completed',
  failedMessageFallback: 'Webhook failed',
};

/**
 * Strips a leading `#!` line so the wrapped script owns the shebang (cron / webhook installers).
 */
export function stripOptionalShebang(scriptBody: string): string {
  const t = scriptBody.trim();
  if (!t.startsWith('#!')) {
    return t;
  }
  return t.split(/\r?\n/).slice(1).join('\n').trim();
}

function bashDefaultChannelTitleLines(
  line: string,
  channelTitleFallback: string,
): string {
  return line.replace(
    '${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}',
    `\${WEEHAWK_NOTIFY_CHANNEL_NAME:-${channelTitleFallback}}`,
  );
}

function bashTrapMessageFallbacks(
  line: string,
  completed: string,
  failed: string,
): string {
  return line
    .replace('Cron job completed', completed)
    .replace('Cron job failed', failed);
}

/**
 * Remote `bash -s` body: writes `.env` + wrapped `.sh` (sources env, `send_notification`, EXIT trap).
 * Matches cron remote script installs; title / default exit messages differ for webhooks.
 */
export function buildRemoteEnvAndWrappedShInstallScript(options: {
  parentDirShQuoted: string;
  envPath: string;
  scriptPath: string;
  envLines: string[];
  userScriptBody: string;
  defaults: RemoteNotifyScriptDefaults;
  /**
   * When true, run the user script on the remote host filesystem via Docker socket
   * (for webhook-agent-in-container deployments).
   */
  runUserScriptOnHostViaDockerSocket?: boolean;
}): string {
  const envPathQ = remoteInstallShQuote(options.envPath);
  const scriptPathQ = remoteInstallShQuote(options.scriptPath);
  const d = options.defaults;
  const innerShLines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `ENV_FILE=${envPathQ}`,
    'if [ -f "$ENV_FILE" ]; then',
    '  set -a',
    '  # shellcheck disable=SC1090',
    '  . "$ENV_FILE"',
    '  set +a',
    'fi',
    'json_escape() {',
    "  printf '%s' \"$1\" | sed 's/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g; s/\r/\\\\r/g; s/\n/\\\\n/g'",
    '}',
    'send_notification() {',
    '  if [ "${WEEHAWK_NOTIFY_ENABLED:-0}" != "1" ]; then return 0; fi',
    '  local msg="$1"',
    '  local t="${WEEHAWK_NOTIFY_TYPE:-}"',
    '  case "$t" in',
    '    telegram)',
    '      [ -n "${WEEHAWK_NOTIFY_TOKEN:-}" ] && [ -n "${WEEHAWK_NOTIFY_TARGET:-}" ] || return 0',
    '      curl -fsS -X POST "https://api.telegram.org/bot${WEEHAWK_NOTIFY_TOKEN}/sendMessage" --data-urlencode "chat_id=${WEEHAWK_NOTIFY_TARGET}" --data-urlencode "text=${msg}" >/dev/null 2>&1 || true',
    '      ;;',
    '    slack|microsoft-teams)',
    '      [ -n "${WEEHAWK_NOTIFY_WEBHOOK_URL:-}" ] || return 0',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"text\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_WEBHOOK_URL}" >/dev/null 2>&1 || true',
    '      ;;',
    '    discord)',
    '      [ -n "${WEEHAWK_NOTIFY_WEBHOOK_URL:-}" ] || return 0',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"content\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_WEBHOOK_URL}" >/dev/null 2>&1 || true',
    '      ;;',
    '    lark)',
    '      [ -n "${WEEHAWK_NOTIFY_WEBHOOK_URL:-}" ] || return 0',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$(json_escape "$msg")\"}}" "${WEEHAWK_NOTIFY_WEBHOOK_URL}" >/dev/null 2>&1 || true',
    '      ;;',
    '    gotify)',
    '      [ -n "${WEEHAWK_NOTIFY_SERVER_URL:-}" ] && [ -n "${WEEHAWK_NOTIFY_APP_TOKEN:-}" ] || return 0',
    '      curl -fsS -X POST -H "Content-Type: application/json" -d "{\"title\":\"$(json_escape "${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}")\",\"message\":\"$(json_escape "$msg")\",\"priority\":${WEEHAWK_NOTIFY_PRIORITY:-5}}" "${WEEHAWK_NOTIFY_SERVER_URL%/}/message?token=${WEEHAWK_NOTIFY_APP_TOKEN}" >/dev/null 2>&1 || true',
    '      ;;',
    '    ntfy)',
    '      [ -n "${WEEHAWK_NOTIFY_SERVER_URL:-}" ] && [ -n "${WEEHAWK_NOTIFY_TOPIC:-}" ] || return 0',
    '      if [ -n "${WEEHAWK_NOTIFY_TOKEN:-}" ]; then',
    '        curl -fsS -X POST -H "Authorization: Bearer ${WEEHAWK_NOTIFY_TOKEN}" -H "Content-Type: application/json" -d "{\"topic\":\"$(json_escape "${WEEHAWK_NOTIFY_TOPIC}")\",\"title\":\"$(json_escape "${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}")\",\"message\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_SERVER_URL%/}/${WEEHAWK_NOTIFY_TOPIC}" >/dev/null 2>&1 || true',
    '      else',
    '        curl -fsS -X POST -H "Content-Type: application/json" -d "{\"topic\":\"$(json_escape "${WEEHAWK_NOTIFY_TOPIC}")\",\"title\":\"$(json_escape "${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}")\",\"message\":\"$(json_escape "$msg")\"}" "${WEEHAWK_NOTIFY_SERVER_URL%/}/${WEEHAWK_NOTIFY_TOPIC}" >/dev/null 2>&1 || true',
    '      fi',
    '      ;;',
    '    pushover)',
    '      [ -n "${WEEHAWK_NOTIFY_APP_TOKEN:-}" ] && [ -n "${WEEHAWK_NOTIFY_USER_KEY:-}" ] || return 0',
    '      if [ -n "${WEEHAWK_NOTIFY_DEVICE:-}" ]; then',
    '        curl -fsS -X POST "https://api.pushover.net/1/messages.json" --data-urlencode "token=${WEEHAWK_NOTIFY_APP_TOKEN}" --data-urlencode "user=${WEEHAWK_NOTIFY_USER_KEY}" --data-urlencode "device=${WEEHAWK_NOTIFY_DEVICE}" --data-urlencode "title=${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}" --data-urlencode "message=${msg}" >/dev/null 2>&1 || true',
    '      else',
    '        curl -fsS -X POST "https://api.pushover.net/1/messages.json" --data-urlencode "token=${WEEHAWK_NOTIFY_APP_TOKEN}" --data-urlencode "user=${WEEHAWK_NOTIFY_USER_KEY}" --data-urlencode "title=${WEEHAWK_NOTIFY_CHANNEL_NAME:-Cron Job}" --data-urlencode "message=${msg}" >/dev/null 2>&1 || true',
    '      fi',
    '      ;;',
    '  esac',
    '}',
    'trap \'exit_code=$?; if [ "${WEEHAWK_NOTIFY_ENABLED:-0}" = "1" ]; then if [ "$exit_code" -eq 0 ]; then send_notification "${WEEHAWK_NOTIFY_MESSAGE:-Cron job completed}"; else send_notification "${WEEHAWK_NOTIFY_MESSAGE:-Cron job failed} (exit $exit_code)"; fi; fi; exit "$exit_code"\' EXIT',
  ].map((line) => bashDefaultChannelTitleLines(line, d.channelTitleFallback));
  const trapIdx = innerShLines.length - 1;
  innerShLines[trapIdx] = bashTrapMessageFallbacks(
    innerShLines[trapIdx],
    d.completedMessageFallback,
    d.failedMessageFallback,
  );
  if (options.runUserScriptOnHostViaDockerSocket === true) {
    innerShLines.push(
      '',
      '# Execute the user script on the host (not inside webhook-agent container).',
      'if ! command -v docker >/dev/null 2>&1; then',
      '  echo "docker CLI not found; cannot run webhook script on host." >&2',
      '  exit 127',
      'fi',
      "docker run --rm -i -v /:/host alpine:3.20 sh -euo pipefail -c '",
      '  umask 077',
      "  script_path='/host/tmp/weehawk-user-webhook.sh'",
      '  cat > \"$script_path\"',
      '  chmod 700 \"$script_path\"',
      "  runner='/bin/bash'",
      "  if [ ! -x '/host/bin/bash' ]; then",
      "    runner='/bin/sh'",
      '  fi',
      "  if [ ! -x \"/host$runner\" ]; then",
      '    echo \"host shell not found: $runner\" >&2',
      '    exit 127',
      '  fi',
      '  chroot /host "$runner" -eu /tmp/weehawk-user-webhook.sh',
      '  rc=$?',
      '  rm -f "$script_path"',
      '  exit "$rc"',
      "' <<'WEEHAWK_USER_SCRIPT'",
      stripOptionalShebang(options.userScriptBody),
      'WEEHAWK_USER_SCRIPT',
    );
  } else {
    innerShLines.push(stripOptionalShebang(options.userScriptBody));
  }

  return [
    'set -eu',
    'umask 077',
    `mkdir -p ${options.parentDirShQuoted}`,
    `cat > ${envPathQ} <<'WEEHAWK_ENV'`,
    ...options.envLines,
    'WEEHAWK_ENV',
    `chmod 600 ${envPathQ}`,
    `cat > ${scriptPathQ} <<'WEEHAWK_EOF'`,
    ...innerShLines,
    'WEEHAWK_EOF',
    `chmod 700 ${scriptPathQ}`,
  ].join('\n');
}
