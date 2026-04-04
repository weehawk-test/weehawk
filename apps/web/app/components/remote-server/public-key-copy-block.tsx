"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function PublicKeyCopyBlock({ publicKey }: { publicKey: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-emerald-500/15 bg-emerald-500/[0.06]">
        <span className="text-xs font-medium text-emerald-200/90">
          Public key — add this line to <code className="text-[11px]">~/.ssh/authorized_keys</code> on the remote host
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(publicKey).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
          className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline shrink-0"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="text-[11px] leading-relaxed p-3 font-mono text-zinc-300 whitespace-pre-wrap break-all max-h-28 overflow-auto">
        {publicKey}
      </pre>
    </div>
  );
}
