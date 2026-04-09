import Link from "next/link";
import { FolderKanban } from "lucide-react";

type Props = {
  current: string;
};

export function RegistryBreadcrumb({ current }: Props) {
  return (
    <nav className="flex items-center gap-2.5 text-sm mb-8" aria-label="Breadcrumb">
      <FolderKanban className="w-4 h-4 shrink-0 text-muted-foreground/80" strokeWidth={1.75} aria-hidden />
      <div className="flex items-center gap-2 min-w-0">
        <Link
          href="/registry"
          scroll={false}
          className="text-muted-foreground hover:text-foreground/90 transition-colors shrink-0"
        >
          Registry
        </Link>
        <span className="text-muted-foreground/45 select-none" aria-hidden>
          /
        </span>
        <span className="text-foreground font-semibold tracking-tight lowercase truncate">{current}</span>
      </div>
    </nav>
  );
}
