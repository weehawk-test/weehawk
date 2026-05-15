import Link from "next/link";
import {
  WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT,
  parseEnterpriseSalesUrl,
} from "@/lib/weehawk-enterprise";

export function EnterpriseLicenseUpsell({
  salesUrl,
  title,
  description,
}: {
  /** Contact / licensing page (from API, usually weehawk.io). */
  salesUrl?: string | null;
  title: string;
  description: string;
}) {
  const href = parseEnterpriseSalesUrl(salesUrl ?? "");

  return (
    <div className="glass-panel rounded-2xl border border-border/80 bg-card/40 p-8 shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>
      <div className="mt-5">
        <Link
          href="/profile/enterprise-license"
          scroll={false}
          className="btn-primary inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Manage license
        </Link>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Enterprise license required. Visit{" "}
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {href.replace(/^https?:\/\//, "") || WEEHAWK_ENTERPRISE_SALES_URL_DEFAULT.replace(/^https?:\/\//, "")}
        </Link>{" "}
        for licensing and contact.
      </p>
    </div>
  );
}
