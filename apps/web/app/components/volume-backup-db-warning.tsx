import { cn } from "@/lib/utils";

type Props = { className?: string };

/** Shown when the user selects volume → S3 backup (DB volumes need care). */
export function VolumeBackupDbWarning({ className }: Props) {
  return (
    <p className={cn("text-[11px] text-sky-800 dark:text-amber-400/90 leading-snug", className)}>
      Prefer <span className="font-medium text-foreground/90">Database backup</span> for database data.
      Volume backup can be inconsistent while the DB is running—stop the database container first if you
      still want a raw volume archive.
    </p>
  );
}
