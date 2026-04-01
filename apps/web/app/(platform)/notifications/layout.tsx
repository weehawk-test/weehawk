import { NotificationsTabs } from "./notifications-tabs";

export default function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NotificationsTabs />
      {children}
    </>
  );
}
