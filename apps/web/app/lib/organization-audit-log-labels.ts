/** Human-readable labels for `OrganizationAuditLogEntry.action` values from the API. */
const LABELS: Record<string, string> = {
  "org.created": "Organization created",
  "org.updated": "Organization updated",
  "member.invited": "Member invited",
  "member.joined": "Member joined",
  "member.left": "Member left",
  "member.role_changed": "Member role changed",
  "member.permissions_updated": "Member permissions updated",
  "security.webhook.created": "Webhook created",
  "security.webhook.updated": "Webhook updated",
  "security.webhook.deleted": "Webhook deleted",
  "security.cron_job.created": "Cron job created",
  "security.cron_job.updated": "Cron job updated",
  "security.cron_job.deleted": "Cron job deleted",
  "security.cron_job.run_now": "Cron job run (manual)",
  "security.remote_terminal.exec": "Remote terminal command",
  "security.remote_terminal.session_opened": "Remote terminal session opened (SSH)",
  "domains.deploy_hostnames_updated": "Deploy site hostnames updated",
  "domains.acme_email_updated": "ACME / certificate contact email updated",
  "domains.platform_hostname_updated": "Platform UI hostname updated",
  "security.project.created": "Project created",
  "security.project.updated": "Project updated",
  "security.project.deleted": "Project deleted",
  "security.service.created": "Service created",
  "security.service.deleted": "Service deleted",
  "security.remote_server.created": "Remote server created",
  "security.remote_server.updated": "Remote server updated",
  "security.remote_server.deleted": "Remote server deleted",
  "security.remote_server.connection_tested": "Remote server connection test",
  "security.remote_server.provision_enqueued": "Remote server install / maintenance job queued",
  "security.remote_docker.container_removed": "Remote Docker: container removed",
  "security.remote_docker.image_removed": "Remote Docker: image removed",
  "security.remote_docker.volume_removed": "Remote Docker: volume removed",
  "security.remote_docker.network_removed": "Remote Docker: network removed",
  "security.remote_docker.service_removed": "Remote Docker: Swarm service removed",
  "security.remote_docker.swarm_secret_created": "Remote Docker: Swarm secret created",
  "security.remote_docker.swarm_secret_deleted": "Remote Docker: Swarm secret removed",
  "security.remote_docker.swarm_secrets_bulk_imported":
    "Remote Docker: Swarm secrets bulk import",
  "security.notification_channel.created": "Notification channel created",
  "security.notification_channel.updated": "Notification channel updated",
  "security.notification_channel.deleted": "Notification channel deleted",
  "security.notification_channel.tested": "Notification channel test send",
  "security.notification_channels.bulk_deleted": "Notification channels bulk deleted",
  "security.s3.profile_created": "S3 profile created",
  "security.s3.profile_updated": "S3 profile updated",
  "security.s3.profile_deleted": "S3 profile deleted",
  "security.s3.connection_tested": "S3 connection test",
  "security.s3.object_deleted": "S3 object deleted",
  "security.s3.objects_batch_deleted": "S3 batch object delete",
  "security.s3.prefix_deleted": "S3 prefix delete (recursive)",
  "security.s3.object_uploaded": "S3 object uploaded",
  "security.s3.folder_marker_created": "S3 folder marker created",
  "security.s3.presign_put_issued": "S3 presigned upload URL issued",
  "security.git.settings_updated": "Git integration settings updated",
  "security.git.github_manifest_exchanged": "GitHub App registered (manifest exchange)",
  "security.registry.account_created": "Registry account created",
  "security.registry.account_updated": "Registry account updated",
  "security.registry.account_deleted": "Registry account removed",
  "security.http.request_rejected": "HTTP request rejected (4xx)",
};

export function organizationAuditActionLabel(action: string): string {
  return LABELS[action] ?? action.replaceAll(".", " ");
}

export function organizationAuditEndpoint(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const ep = metadata?.endpoint;
  if (typeof ep !== "string" || ep.trim() === "") return "—";
  let out = ep.trim();
  const remoteServerPublicId = metadata?.remoteServerPublicId;
  if (
    typeof remoteServerPublicId === "string" &&
    remoteServerPublicId.trim() !== ""
  ) {
    // Legacy events may store internal numeric id in endpoint path.
    out = out.replace(
      /(\/api\/remote-servers\/)\d+(\b|\/)/,
      `$1${remoteServerPublicId.trim()}$2`,
    );
  }
  const webhookPublicId = metadata?.webhookPublicId;
  if (typeof webhookPublicId === "string" && webhookPublicId.trim() !== "") {
    out = out.replace(
      /(\/api\/webhooks\/)\d+(\b|\/)/,
      `$1${webhookPublicId.trim()}$2`,
    );
  }
  const cronJobPublicId = metadata?.cronJobPublicId;
  if (typeof cronJobPublicId === "string" && cronJobPublicId.trim() !== "") {
    out = out.replace(
      /(\/api\/cron-jobs\/)\d+(\b|\/)/,
      `$1${cronJobPublicId.trim()}$2`,
    );
  }
  const notificationChannelPublicId = metadata?.notificationChannelPublicId;
  if (
    typeof notificationChannelPublicId === "string" &&
    notificationChannelPublicId.trim() !== ""
  ) {
    out = out.replace(
      /(\/api\/notifications\/channels\/)\d+(\b|\/)/,
      `$1${notificationChannelPublicId.trim()}$2`,
    );
  }
  const registryAccountPublicId = metadata?.registryAccountPublicId;
  if (
    typeof registryAccountPublicId === "string" &&
    registryAccountPublicId.trim() !== ""
  ) {
    out = out.replace(
      /(\/api\/registry\/accounts\/)\d+(\b|\/)/,
      `$1${registryAccountPublicId.trim()}$2`,
    );
  }
  const servicePublicId = metadata?.servicePublicId;
  if (typeof servicePublicId === "string" && servicePublicId.trim() !== "") {
    out = out.replace(
      /(\/api\/services\/)\d+(\b|\/)/,
      `$1${servicePublicId.trim()}$2`,
    );
  }
  return out;
}

/** HTTP status from API security audit metadata (`httpStatus`), when present. */
export function organizationAuditHttpStatus(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const raw = metadata?.httpStatus;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(Math.trunc(raw));
  if (typeof raw === "string" && /^\d{3}$/.test(raw.trim())) return raw.trim();
  return "—";
}

/** Target column: member invite/join metadata (`targetEmail`), then resource fields from security metadata. */
export function organizationAuditTargetSummary(
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (!metadata) return "—";
  const keys = [
    "targetEmail",
    "organizationUpdateTarget",
    "memberLeftSummary",
    "organizationPublicId",
    "promotedNewOwnerEmail",
    "webhookName",
    "cronJobName",
    "remoteServerName",
    "webhookPublicId",
    "cronJobPublicId",
    "remoteServerPublicId",
    "acmeEmail",
    "platformDomain",
    "projectName",
    "projectPublicId",
    "serviceAppName",
    "servicePublicId",
    "gitTarget",
    "notificationChannelName",
    "notificationChannelPublicId",
    "s3ProfileName",
    "s3ProfilePublicId",
    "registryAccountName",
    "registryAccountPublicId",
    "registryProviderUrl",
    "githubAppSlug",
    "githubAppId",
    "secretName",
    "bulkImportMessage",
    "reason",
    "errorSummary",
    "objectKey",
    "imageRef",
    "prefix",
    "jobKind",
  ] as const;
  for (const k of keys) {
    const v = metadata[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  const removed = metadata?.removedCount;
  if (typeof removed === "number" && Number.isFinite(removed) && removed >= 1) {
    return `${Math.trunc(removed)} removed`;
  }
  const chId = metadata?.notificationChannelId;
  if (typeof chId === "number" && Number.isFinite(chId) && chId >= 1) {
    return `channel #${Math.trunc(chId)}`;
  }
  return "—";
}
