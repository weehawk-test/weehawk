import { Notification } from './entities/notification.entity';

export function notificationPlainText(n: Notification): string {
  const t = n.title.trim();
  const m = n.message.trim();
  if (!t) return m;
  if (!m) return t;
  return `${t}\n\n${m}`;
}
