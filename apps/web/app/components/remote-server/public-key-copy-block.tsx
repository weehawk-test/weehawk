"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function PublicKeyCopyBlock({ publicKey }: { publicKey: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-emerald-600/35 bg-emerald-50/95 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-500/5 dark:shadow-none overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-emerald-600/20 bg-emerald-100/80 dark:border-emerald-500/15 dark:bg-emerald-500/[0.06]">
        <span className="text-xs font-medium text-emerald-950 dark:text-emerald-200/90">
          Public key — add this line to{" "}
          <code className="text-[11px] font-mono rounded px-1 py-0.5 bg-emerald-200/70 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-100">
            ~/.ssh/authorized_keys
          </code>{" "}
          on the remote host
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(publicKey).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-900 hover:underline dark:text-emerald-400 shrink-0"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed p-3 font-mono whitespace-pre-wrap break-all max-h-28 overflow-auto border-t border-emerald-200/70 bg-white text-zinc-900 shadow-inner dark:border-emerald-950/40 dark:bg-zinc-950 dark:text-zinc-300">
        {publicKey}
      </pre>
    </div>
  );
}
