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
  "domains.deploy_hostnames_updated": "Deploy site hostnames updated",
  "domains.acme_email_updated": "ACME / certificate contact email updated",
  "domains.platform_hostname_updated": "Platform UI hostname updated",
  "security.project.created": "Project created",
  "security.project.updated": "Project updated",
  "security.project.deleted": "Project deleted",
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
};

export function organizationAuditActionLabel(action: string): string {
  return LABELS[action] ?? action.replaceAll(".", " ");
}

export function organizationAuditEndpoint(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const ep = metadata?.endpoint;
  return typeof ep === "string" && ep.trim() !== "" ? ep : "—";
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

/** Prefer explicit target email; otherwise show resource name from security metadata. */
export function organizationAuditTargetSummary(
  targetEmail: string | null,
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (targetEmail && targetEmail.trim() !== "") return targetEmail;
  if (!metadata) return "—";
  const keys = [
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
    "notificationChannelName",
    "notificationChannelPublicId",
    "s3ProfileName",
    "s3ProfilePublicId",
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
