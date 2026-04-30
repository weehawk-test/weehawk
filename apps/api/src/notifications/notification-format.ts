/** Plain text for providers / remote curl (title + body). */
export function formatNotificationPlainText(
  title: string,
  message: string,
): string {
  const t = title.trim();
  const m = message.trim();
  if (!t) return m;
  if (!m) return t;
  return `${t}\n\n${m}`;
}
