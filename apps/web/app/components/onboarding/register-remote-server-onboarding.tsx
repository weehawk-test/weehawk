"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, PlugZap } from "lucide-react";
import { MaskedPemTextarea } from "@/components/remote-server/masked-pem-textarea";
import { PublicKeyCopyBlock } from "@/components/remote-server/public-key-copy-block";
import {
  createRemoteServerApi,
  generateRemoteSshKeypairApi,
  testRemoteServerApi,
  testRemoteServerSshApi,
  type RemoteServerRow,
  type RemoteServerRole,
} from "@/lib/remote-servers-api";
import { useToast } from "@/hooks/use-toast";

type Props = {
  accessToken: string;
  onSaved?: (row: RemoteServerRow) => void;
};

export function RegisterRemoteServerOnboarding({ accessToken, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [sshUser, setSshUser] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [serverRole, setServerRole] = useState<RemoteServerRole>("deploy");
  const [acmeEmail, setAcmeEmail] = useState("");
  const [generatedPublicKey, setGeneratedPublicKey] = useState<string | null>(null);
  const [savedRow, setSavedRow] = useState<RemoteServerRow | null>(null);

  const generateMut = useMutation({
    mutationFn: () => generateRemoteSshKeypairApi(accessToken),
    onSuccess: (data) => {
      setGeneratedPublicKey(data.publicKey);
      setPrivateKey(data.privateKey);
      setShowPrivateKey(false);
      setSavedRow(null);
      toast({
        title: "Key pair generated",
        description: "Add the public key to ~/.ssh/authorized_keys on the server, then save below.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createRemoteServerApi(accessToken, {
        name: name.trim(),
        host: host.trim(),
        port: port.trim() ? Number(port) : 22,
        sshUser: sshUser.trim(),
        privateKey: privateKey.trim(),
        serverRole,
        acmeEmail: acmeEmail.trim(),
      }),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ["remote-servers"] });
      setSavedRow(row);
      setShowPrivateKey(false);
      onSaved?.(row);
      toast({ title: "Remote host saved", description: "You can test the connection, then continue." });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => testRemoteServerApi(accessToken, id),
    onSuccess: (data) => {
      toast({
        title: data.success ? "Docker reachable" : "Connection failed",
        description: data.output.slice(0, 900) + (data.output.length > 900 ? "…" : ""),
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const testSshMut = useMutation({
    mutationFn: (id: string) => testRemoteServerSshApi(accessToken, id),
    onSuccess: (data) => {
      toast({
        title: data.success ? "Connected via SSH" : "SSH connection failed",
        description: data.output.slice(0, 900) + (data.output.length > 900 ? "…" : ""),
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (e: Error) =>
      toast({ title: "SSH test failed", description: e.message, variant: "destructive" }),
  });

  const canSave =
    name.trim().length > 0 &&
    host.trim().length > 0 &&
    sshUser.trim().length > 0 &&
    privateKey.trim().length >= 64 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acmeEmail.trim());

  return (
    <div className="mt-5 space-y-4 rounded-xl border border-border bg-white/[0.02] p-4 sm:p-5 text-left">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">SSH connection</p>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          Generate a key or paste your own, add the public key to the server, then save. Keys are stored encrypted on
          the database.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={generateMut.isPending}
          onClick={() => generateMut.mutate()}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-violet-600/40 bg-violet-500/20 text-violet-950 hover:bg-violet-500/30 dark:border-violet-500/35 dark:bg-violet-500/15 dark:text-violet-100 dark:hover:bg-violet-500/20 disabled:opacity-50"
        >
          {generateMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
          Generate key pair
        </button>
      </div>

      {generatedPublicKey ? <PublicKeyCopyBlock publicKey={generatedPublicKey} /> : null}

      <div className="space-y-2">
        <span className="text-xs text-muted-foreground">Server role</span>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { value: "deploy" as const, title: "Deploy", hint: "Run containers here" },
              { value: "build" as const, title: "Build", hint: "Image builds only" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setServerRole(opt.value)}
              className={`flex-1 min-w-[120px] text-left rounded-lg border px-3 py-2 transition-colors ${
                serverRole === opt.value
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-muted/60 dark:bg-black/20 text-muted-foreground hover:border-border"
              }`}
            >
              <span className="text-xs font-medium block">{opt.title}</span>
              <span className="text-[10px] text-muted-foreground block mt-0.5">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">Label</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSavedRow(null);
            }}
            className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm"
            placeholder="Production"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">Host / IP</span>
          <input
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
              setSavedRow(null);
            }}
            className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm"
            placeholder="203.0.113.10"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">SSH port</span>
          <input
            value={port}
            onChange={(e) => {
              setPort(e.target.value);
              setSavedRow(null);
            }}
            className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm"
            placeholder="22"
          />
        </label>
        <label className="space-y-1 block">
          <span className="text-xs text-muted-foreground">SSH user</span>
          <input
            value={sshUser}
            onChange={(e) => {
              setSshUser(e.target.value);
              setSavedRow(null);
            }}
            className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm"
            placeholder="deploy"
          />
        </label>
        <label className="space-y-1 block sm:col-span-2">
          <span className="text-xs text-muted-foreground">
            Certificate email (For Let&apos;s Encrypt notices)
          </span>
          <input
            type="email"
            value={acmeEmail}
            onChange={(e) => {
              setAcmeEmail(e.target.value);
              setSavedRow(null);
            }}
            className="w-full rounded-lg border border-border bg-black/40 px-3 py-2 text-sm"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <div className="space-y-1 sm:col-span-2">
          <span className="block text-xs text-muted-foreground">Private key (PEM)</span>
          <MaskedPemTextarea
            revealed={showPrivateKey}
            onRevealedChange={setShowPrivateKey}
            value={privateKey}
            onChange={(e) => {
              setPrivateKey(e.target.value);
              setGeneratedPublicKey(null);
              setSavedRow(null);
            }}
            className="w-full min-h-[120px] rounded-lg border border-border bg-black/40 px-3 py-2 text-xs font-mono"
            placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n..."}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <button
          type="button"
          disabled={!canSave || createMut.isPending}
          onClick={() => createMut.mutate()}
          className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 disabled:opacity-50"
        >
          {createMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {createMut.isPending ? "Saving…" : "Save to database"}
        </button>
        <button
          type="button"
          disabled={!savedRow || testSshMut.isPending}
          onClick={() =>
            savedRow &&
            testSshMut.mutate(savedRow.publicId?.trim() || String(savedRow.id))
          }
          className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-white/15 bg-white/[0.04] text-foreground disabled:opacity-50"
        >
          {testSshMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
          Test SSH
        </button>
        <button
          type="button"
          disabled={!savedRow || testMut.isPending}
          onClick={() =>
            savedRow && testMut.mutate(savedRow.publicId?.trim() || String(savedRow.id))
          }
          className="inline-flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-white/15 bg-white/[0.04] text-foreground disabled:opacity-50"
        >
          {testMut.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
          Test Docker
        </button>
      </div>
      {savedRow ? (
        <p className="text-[11px] text-muted-foreground">
          Host saved as <span className="text-foreground/90 font-medium">{savedRow.name}</span>. Test SSH first, then
          Test Docker (remote API), then use <span className="text-foreground/90">Set up later</span> below when you are
          ready to open the app.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          You can continue without saving and add a host later from <span className="text-foreground/90">Remote server</span>{" "}
          in the app.
        </p>
      )}
    </div>
  );
}
