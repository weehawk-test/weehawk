"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Terminal } from "lucide-react";
import { useService } from "@/hooks/use-services";
import { serviceTerminalWsUrl } from "@/lib/services-api";

type Props = {
  serviceId: string;
};

export function ServiceTerminalPanel({ serviceId }: Props) {
  const { data: service } = useService(serviceId);
  const remoteDeploy =
    service != null &&
    typeof service.remoteServerId === "number" &&
    service.remoteServerId > 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fit: import("@xterm/addon-fit").FitAddon | null = null;
    let ro: ResizeObserver | null = null;
    const textEnc = new TextEncoder();

    const pushResize = () => {
      if (disposed || !ws || ws.readyState !== WebSocket.OPEN || !term) return;
      try {
        ws.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows,
          }),
        );
      } catch {
        /* ignore */
      }
    };

    const onResize = () => {
      try {
        fit?.fit();
        pushResize();
      } catch {
        /* ignore */
      }
    };

    void (async () => {
      setError(null);
      setConnecting(true);
      el.innerHTML = "";

      const { Terminal: TerminalClass } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");

      if (disposed) return;

      const t = new TerminalClass({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: {
          background: "#09090b",
          foreground: "#e4e4e7",
        },
      });
      const fa = new FitAddon();
      t.loadAddon(fa);
      t.open(el);
      fa.fit();
      term = t;
      fit = fa;

      window.addEventListener("resize", onResize);
      ro = new ResizeObserver(onResize);
      ro.observe(el);

      ws = new WebSocket(serviceTerminalWsUrl(serviceId));
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (disposed) return;
        setConnecting(false);
        fa.fit();
        pushResize();
        t.focus();
      };

      ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
        if (disposed) return;
        if (typeof ev.data === "string") {
          try {
            const j = JSON.parse(ev.data) as { type?: string; message?: string };
            if (j.type === "error" && j.message) {
              setError(j.message);
              return;
            }
          } catch {
            t.write(ev.data);
          }
          return;
        }
        t.write(new Uint8Array(ev.data as ArrayBuffer));
      };

      ws.onerror = () => {
        if (disposed) return;
        setConnecting(false);
        setError("WebSocket connection failed.");
      };

      ws.onclose = (ev) => {
        if (disposed) return;
        setConnecting(false);
        if (ev.code !== 1000 && ev.reason) {
          setError((prev) => prev ?? ev.reason);
        }
      };

      t.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(textEnc.encode(data));
      });
    })();

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      ws?.close();
      term?.dispose();
    };
  }, [serviceId]);

  return (
    <div className="glass-panel rounded-xl overflow-hidden border border-border/60 flex flex-col min-h-[min(70vh,560px)] max-h-[min(88vh,760px)]">
      <div className="px-5 pt-5 pb-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Terminal className="w-5 h-5 text-primary shrink-0" />
          <h2 className="text-base font-semibold tracking-tight">Terminal</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Interactive shell inside this service&apos;s Docker{" "}
          <span className="font-medium text-foreground/90">container</span>.
          {!remoteDeploy && (
            <>
              {" "}
              Runs on the same machine as the Weehawk API using local Docker. If you see a Windows <code className="text-[10px]">npipe</code>{" "}
              error, start Docker Desktop on the PC running the API.
            </>
          )}
        </p>
      </div>

      <div className="flex-1 min-h-[200px] flex flex-col px-3 pb-3 pt-2">
        {error && (
          <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {connecting && !error && (
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Connecting…
          </div>
        )}
        <div ref={containerRef} className="flex-1 min-h-[280px] w-full rounded-lg overflow-hidden border border-border/50 bg-zinc-950" />
      </div>
    </div>
  );
}
