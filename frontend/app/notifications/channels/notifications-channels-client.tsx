"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Layers,
  Gamepad2,
  Bird,
  Users,
  Mail,
  SendHorizontal,
  BellRing,
  ShieldAlert,
  Bell,
  Plus,
  Search,
  Send,
  Trash2,
  MessageCircle,
  Eye,
  EyeOff,
  ExternalLink,
  FlaskConical,
  Loader2,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import {
  createNotificationChannel,
  bulkDeleteNotificationChannels,
  deleteNotificationChannel,
  fetchNotificationChannelsPaged,
  sendNotification,
  testNotificationChannel,
  testTelegramCredentials,
  type PaginatedNotificationChannelsResponse,
} from "@/lib/notifications-api";
import { ListPagination } from "@/components/docker/ListPagination";
import { useBulkSelection } from "@/components/docker/useBulkSelection";
import { DockerBulkCheckbox } from "@/components/docker/DockerBulkCheckbox";
import { useConfirm } from "@/components/confirm/ConfirmProvider";

const CHANNEL_TYPE_OPTIONS = [
  { value: "telegram", label: "Telegram", icon: Send, iconClass: "text-sky-400" },
  { value: "stack", label: "Stack", icon: Layers, iconClass: "text-orange-400" },
  { value: "discord", label: "Discord", icon: Gamepad2, iconClass: "text-indigo-400" },
  { value: "lark", label: "Lark", icon: Bird, iconClass: "text-cyan-400" },
  { value: "microsoft-teams", label: "Microsoft Teams", icon: Users, iconClass: "text-blue-400" },
  { value: "email", label: "Email", icon: Mail, iconClass: "text-emerald-400" },
  { value: "resend", label: "Resend", icon: SendHorizontal, iconClass: "text-violet-400" },
  { value: "gotify", label: "Gotify", icon: BellRing, iconClass: "text-lime-400" },
  { value: "ntfy", label: "ntfy", icon: Bell, iconClass: "text-amber-400" },
  { value: "pushover", label: "Pushover", icon: ShieldAlert, iconClass: "text-rose-400" },
] as const;

const channelTypeLabel = (type: string) =>
  CHANNEL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
const channelTypeMeta = (type: string) =>
  CHANNEL_TYPE_OPTIONS.find((option) => option.value === type);

export function NotificationsChannelsClient({
  initialData,
  initialError,
  urlPage,
  urlQ,
}: {
  initialData: PaginatedNotificationChannelsResponse | null;
  initialError: string | null;
  urlPage: number;
  urlQ: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();

  const CHANNELS_PAGE_SIZE = 10;
  const [channelsPage, setChannelsPage] = useState(urlPage);
  const [channelsQ, setChannelsQ] = useState(urlQ);
  const [channelsLocalQ, setChannelsLocalQ] = useState(urlQ);

  useEffect(() => {
    setChannelsPage(urlPage);
    setChannelsQ(urlQ);
    setChannelsLocalQ(urlQ);
  }, [urlPage, urlQ]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = channelsLocalQ.trim();
      if (trimmed === channelsQ.trim()) return;
      setChannelsQ(trimmed);
      setChannelsPage(1);
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 400);
    return () => window.clearTimeout(t);
  }, [channelsLocalQ, channelsQ, pathname, router]);

  const channelsPagedQuery = useQuery({
    queryKey: ["notifications", "channels", "paged", channelsPage, channelsQ],
    queryFn: () =>
      fetchNotificationChannelsPaged(
        accessToken!,
        channelsPage,
        CHANNELS_PAGE_SIZE,
        channelsQ,
      ),
    enabled: Boolean(accessToken),
    initialData:
      channelsPage === urlPage && channelsQ.trim() === urlQ.trim()
        ? (initialData ?? undefined)
        : undefined,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const channelsPaged = channelsPagedQuery.data;
  const channels = channelsPaged?.items ?? [];
  const channelKeys = useMemo(() => channels.map((c) => c.id), [channels]);
  const channelsBulk = useBulkSelection(channelKeys);

  const [showAdd, setShowAdd] = useState(false);
  const [revealedTokens, setRevealedTokens] = useState<Set<string>>(new Set());
  const [showChannelAction, setShowChannelAction] = useState(false);
  const [actionChannel, setActionChannel] = useState<{ id: string; name: string } | null>(null);
  const [actionMessage, setActionMessage] = useState("");

  const [form, setForm] = useState({ name: "", type: "telegram" });
  const [telegramForm, setTelegramForm] = useState({ token: "", target: "" });
  const [emailForm, setEmailForm] = useState({
    smtpServer: "smtp.gmail.com",
    smtpPort: "587",
    username: "",
    password: "",
    fromAddress: "",
    toAddresses: [""],
  });
  const [discordForm, setDiscordForm] = useState({ webhookUrl: "" });
  const [larkForm, setLarkForm] = useState({ webhookUrl: "", secret: "" });
  const [teamsForm, setTeamsForm] = useState({ webhookUrl: "" });
  const [resendForm, setResendForm] = useState({ apiKey: "", fromAddress: "", toAddress: "" });
  const [gotifyForm, setGotifyForm] = useState({ serverUrl: "", appToken: "", priority: "5" });
  const [ntfyForm, setNtfyForm] = useState({ serverUrl: "https://ntfy.sh", topic: "", token: "" });
  const [pushoverForm, setPushoverForm] = useState({ userKey: "", appToken: "", device: "" });
  const [stackForm, setStackForm] = useState({ webhookUrl: "", project: "" });

  const addEmailRecipient = () => {
    setEmailForm((prev) => ({ ...prev, toAddresses: [...prev.toAddresses, ""] }));
  };
  const removeEmailRecipient = (index: number) => {
    setEmailForm((prev) => ({
      ...prev,
      toAddresses:
        prev.toAddresses.length === 1
          ? prev.toAddresses
          : prev.toAddresses.filter((_, i) => i !== index),
    }));
  };
  const updateEmailRecipient = (index: number, value: string) => {
    setEmailForm((prev) => ({
      ...prev,
      toAddresses: prev.toAddresses.map((item, i) => (i === index ? value : item)),
    }));
  };
  const platformPayload = (): Record<string, unknown> => {
    const channelType = form.type;
    if (channelType === "telegram") return { token: telegramForm.token.trim(), target: telegramForm.target.trim() };
    if (channelType === "email") {
      const toAddresses = emailForm.toAddresses.map((item) => item.trim()).filter(Boolean);
      return {
        smtpServer: emailForm.smtpServer.trim(),
        smtpPort: emailForm.smtpPort.trim(),
        username: emailForm.username.trim(),
        password: emailForm.password.trim(),
        fromAddress: emailForm.fromAddress.trim(),
        toAddresses,
      };
    }
    if (channelType === "discord") return { webhookUrl: discordForm.webhookUrl.trim() };
    if (channelType === "lark") return { webhookUrl: larkForm.webhookUrl.trim(), secret: larkForm.secret.trim() };
    if (channelType === "microsoft-teams") return { webhookUrl: teamsForm.webhookUrl.trim() };
    if (channelType === "resend") {
      return { apiKey: resendForm.apiKey.trim(), fromAddress: resendForm.fromAddress.trim(), toAddress: resendForm.toAddress.trim() };
    }
    if (channelType === "gotify") {
      return { serverUrl: gotifyForm.serverUrl.trim(), appToken: gotifyForm.appToken.trim(), priority: gotifyForm.priority.trim() };
    }
    if (channelType === "ntfy") return { serverUrl: ntfyForm.serverUrl.trim(), topic: ntfyForm.topic.trim(), token: ntfyForm.token.trim() };
    if (channelType === "pushover") return { appToken: pushoverForm.appToken.trim(), userKey: pushoverForm.userKey.trim(), device: pushoverForm.device.trim() };
    return { webhookUrl: stackForm.webhookUrl.trim(), project: stackForm.project.trim() };
  };
  const isPlatformValid = () => {
    if (form.type === "telegram") return Boolean(telegramForm.token.trim() && telegramForm.target.trim());
    if (form.type === "email") {
      return Boolean(
        emailForm.smtpServer.trim() &&
          emailForm.smtpPort.trim() &&
          emailForm.username.trim() &&
          emailForm.password.trim() &&
          emailForm.fromAddress.trim() &&
          emailForm.toAddresses.some((item) => item.trim()),
      );
    }
    if (form.type === "discord") return Boolean(discordForm.webhookUrl.trim());
    if (form.type === "lark") return Boolean(larkForm.webhookUrl.trim());
    if (form.type === "microsoft-teams") return Boolean(teamsForm.webhookUrl.trim());
    if (form.type === "resend") return Boolean(resendForm.apiKey.trim() && resendForm.fromAddress.trim() && resendForm.toAddress.trim());
    if (form.type === "gotify") return Boolean(gotifyForm.serverUrl.trim() && gotifyForm.appToken.trim());
    if (form.type === "ntfy") return Boolean(ntfyForm.serverUrl.trim() && ntfyForm.topic.trim());
    if (form.type === "pushover") return Boolean(pushoverForm.appToken.trim() && pushoverForm.userKey.trim());
    return Boolean(stackForm.webhookUrl.trim());
  };

  const testDraftMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Service name is required.");
      if (form.type === "telegram") {
        return testTelegramCredentials(accessToken!, {
          botToken: telegramForm.token.trim(),
          chatId: telegramForm.target.trim(),
          channelName: form.name.trim() || undefined,
        });
      }
      const tempChannel = await createNotificationChannel(accessToken!, {
        name: `${form.name.trim()} (test)`,
        type: form.type.trim(),
        config: platformPayload(),
      });
      try {
        return await testNotificationChannel(accessToken!, tempChannel.id);
      } finally {
        try {
          await deleteNotificationChannel(accessToken!, tempChannel.id);
        } catch {}
      }
    },
    onSuccess: (log) => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs", "paged"] });
      if (log.status === "sent") toast({ title: "Test sent", description: "test succedded" });
      else toast({ title: "Test failed", description: "Check channel configuration.", variant: "destructive" });
    },
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });
  const createMutation = useMutation({
    mutationFn: () => createNotificationChannel(accessToken!, { name: form.name.trim(), type: form.type.trim(), config: platformPayload() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      setForm({ name: "", type: "telegram" });
      setShowAdd(false);
      toast({ title: "Channel added", description: "Notification channel saved." });
    },
    onError: (e: Error) => toast({ title: "Could not add channel", description: e.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNotificationChannel(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      toast({ title: "Channel removed" });
    },
    onError: (e: Error) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });
  const bulkDeleteChannelsMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteNotificationChannels(accessToken!, ids),
    onSuccess: () => {
      channelsBulk.clear();
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] });
      toast({ title: "Channels removed" });
    },
    onError: (e: Error) => toast({ title: "Could not remove", description: e.message, variant: "destructive" }),
  });
  const sendMutation = useMutation({
    mutationFn: ({ channelId, message }: { channelId: string; message: string }) => sendNotification(accessToken!, { channelId, message: message.trim() }),
    onSuccess: (log) => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs", "paged"] });
      if (log.status === "sent") {
        toast({ title: "Message sent" });
        setShowChannelAction(false);
        setActionMessage("");
      } else {
        toast({ title: "Failed to send", description: "Check channel configuration.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });
  const testMutation = useMutation({
    mutationFn: (channelId: string) => testNotificationChannel(accessToken!, channelId),
    onSuccess: (log) => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs", "paged"] });
      if (log.status === "sent") {
        toast({ title: "Test sent", description: "test succedded" });
        setShowChannelAction(false);
      } else {
        toast({ title: "Test failed", description: "Check channel configuration.", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Test failed", description: e.message, variant: "destructive" }),
  });

  const toggleReveal = (id: string) => setRevealedTokens((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const addChannel = () => {
    if (!form.name.trim()) return toast({ title: "Missing name", description: "Please enter a service name before saving.", variant: "destructive" });
    if (!isPlatformValid()) return toast({ title: "Missing fields", description: "Please complete required fields for this provider.", variant: "destructive" });
    createMutation.mutate();
  };
  const runDraftTest = () => {
    if (!form.name.trim()) return toast({ title: "Missing name", description: "Please enter a service name before testing.", variant: "destructive" });
    if (!isPlatformValid()) return toast({ title: "Missing fields", description: "Please complete required fields for this provider.", variant: "destructive" });
    testDraftMutation.mutate();
  };
  const openChannelActions = (channelId: string, channelName: string) => {
    setActionChannel({ id: channelId, name: channelName });
    setActionMessage("");
    setShowChannelAction(true);
  };
  const runChannelSend = () => {
    if (!actionChannel) return;
    if (!actionMessage.trim()) return toast({ title: "Missing message", description: "Please enter a message before sending.", variant: "destructive" });
    sendMutation.mutate({ channelId: actionChannel.id, message: actionMessage });
  };
  const runChannelTest = () => {
    if (!actionChannel) return;
    testMutation.mutate(actionChannel.id);
  };
  const handleBulkDeleteChannels = async () => {
    const ids = channelsBulk.selectedInFiltered;
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Delete selected channels?",
      description: `Delete ${ids.length} channel(s)?`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    bulkDeleteChannelsMutation.mutate(ids);
  };
  const setChannelsPageUrl = (next: number) => {
    const n = Math.max(1, next);
    setChannelsPage(n);
    const params = new URLSearchParams();
    const q = channelsQ.trim();
    if (q) params.set("q", q);
    params.set("page", String(n));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const loading = Boolean(accessToken) && channelsPagedQuery.isLoading && !channelsPaged;
  const queryErrorMessage =
    channelsPagedQuery.error instanceof Error ? channelsPagedQuery.error.message : "Could not load notifications.";
  const listError = (Boolean(initialError) && !channelsPaged) || (Boolean(accessToken) && channelsPagedQuery.isError);
  const listErrorMessage = !channelsPaged && initialError ? initialError : queryErrorMessage;

  return (
    <AppLayout>
      {/* UI kept same as previous implementation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage notification channels.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Channel
          </button>
        </div>
      </div>
      <div className="flex gap-1 p-1 bg-card/50 rounded-xl border border-white/5 w-fit mb-6">
        {[{ href: "/notifications/channels", label: "Channels", count: channels.length }, { href: "/notifications/history", label: "History", count: 0 }].map((t) => {
          const active = pathname === t.href;
          return (
            <Link key={t.href} href={t.href} className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {active && <motion.div layoutId="notif-tab-route" className="absolute inset-0 bg-white/10 rounded-lg border border-white/10" initial={false} transition={{ type: "spring", stiffness: 400, damping: 35 }} />}
              <span className="relative z-10">{t.label}</span>
              {t.count > 0 && <span className="relative z-10 bg-primary/20 text-primary text-xs rounded-full px-1.5">{t.count}</span>}
            </Link>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <DockerBulkCheckbox checked={channelsBulk.allSelected ? true : channelsBulk.someSelected ? "indeterminate" : false} onCheckedChange={() => channelsBulk.toggleAllFiltered()} aria-label="Select all channels on this page" />
          {channelsBulk.selectedInFiltered.length > 0 && (
            <button type="button" onClick={handleBulkDeleteChannels} disabled={bulkDeleteChannelsMutation.isPending || deleteMutation.isPending} className="btn-secondary border-destructive/40 text-destructive hover:bg-destructive/10 flex items-center gap-2 text-sm">
              {bulkDeleteChannelsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete ({channelsBulk.selectedInFiltered.length})
            </button>
          )}
        </div>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input className="input-field !pl-10 w-full" placeholder="Search channels..." value={channelsLocalQ} onChange={(e) => setChannelsLocalQ(e.target.value)} />
        </div>
      </div>
      {loading && <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
      {listError && !loading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {listErrorMessage}
          <button type="button" className="ml-3 underline underline-offset-2 hover:text-destructive/90" onClick={() => void queryClient.invalidateQueries({ queryKey: ["notifications", "channels", "paged"] })}>
            Retry
          </button>
        </div>
      )}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20 mb-6"
          >
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-primary" />
              Add Notification Channel
            </h3>
            <div className="grid grid-cols-1 gap-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Channel Name</label>
                <input className="input-field" placeholder="e.g. Production Alerts" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">Provider</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {CHANNEL_TYPE_OPTIONS.map((option) => {
                    const PlatformIcon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setForm({ ...form, type: option.value })}
                        className={`rounded-lg border px-3 py-2 text-xs md:text-sm transition-colors ${
                          form.type === option.value
                            ? "border-primary/60 bg-primary/15 text-foreground"
                            : "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <PlatformIcon className={`inline w-4 h-4 mr-1.5 ${option.iconClass}`} />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.type === "telegram" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                      Telegram Token
                      <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 text-[11px]">
                        Get from BotFather <ExternalLink className="w-3 h-3" />
                      </a>
                    </label>
                    <input className="input-field font-mono text-sm" placeholder="123456789:ABCdef..." value={telegramForm.token} onChange={(e) => setTelegramForm({ ...telegramForm, token: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                      Target <span className="text-[11px] text-muted-foreground/60">Use @username or numeric ID</span>
                    </label>
                    <input className="input-field font-mono text-sm" placeholder="-1001234567890" value={telegramForm.target} onChange={(e) => setTelegramForm({ ...telegramForm, target: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "email" && (
                <>
                  <p className="text-sm font-medium">Fill the next fields.</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">SMTP Server</label>
                    <input className="input-field font-mono text-sm" placeholder="smtp.gmail.com" value={emailForm.smtpServer} onChange={(e) => setEmailForm({ ...emailForm, smtpServer: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">SMTP Port</label>
                    <input className="input-field font-mono text-sm" placeholder="587" type="number" value={emailForm.smtpPort} onChange={(e) => setEmailForm({ ...emailForm, smtpPort: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Username</label>
                    <input className="input-field" placeholder="username" value={emailForm.username} onChange={(e) => setEmailForm({ ...emailForm, username: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Password</label>
                    <input className="input-field" type="password" placeholder="****************" value={emailForm.password} onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">From Address</label>
                    <input className="input-field" placeholder="from@example.com" value={emailForm.fromAddress} onChange={(e) => setEmailForm({ ...emailForm, fromAddress: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground block">To Addresses</label>
                    {emailForm.toAddresses.map((address, index) => (
                      <div key={index} className="flex gap-2">
                        <input className="input-field" placeholder="email@example.com" value={address} onChange={(e) => updateEmailRecipient(index, e.target.value)} />
                        <button type="button" onClick={() => removeEmailRecipient(index)} className="btn-secondary text-xs px-3" disabled={emailForm.toAddresses.length === 1}>
                          Remove
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addEmailRecipient} className="btn-secondary text-sm w-full">
                      Add
                    </button>
                  </div>
                </>
              )}

              {form.type === "discord" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Webhook URL</label>
                  <input className="input-field font-mono text-sm" placeholder="https://discord.com/api/webhooks/..." value={discordForm.webhookUrl} onChange={(e) => setDiscordForm({ webhookUrl: e.target.value })} />
                </div>
              )}

              {form.type === "lark" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Webhook URL</label>
                    <input className="input-field font-mono text-sm" placeholder="https://open.larksuite.com/open-apis/bot/v2/hook/..." value={larkForm.webhookUrl} onChange={(e) => setLarkForm({ ...larkForm, webhookUrl: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Secret (optional)</label>
                    <input className="input-field" placeholder="Lark signing secret" value={larkForm.secret} onChange={(e) => setLarkForm({ ...larkForm, secret: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "microsoft-teams" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Incoming Webhook URL</label>
                  <input className="input-field font-mono text-sm" placeholder="https://outlook.office.com/webhook/..." value={teamsForm.webhookUrl} onChange={(e) => setTeamsForm({ webhookUrl: e.target.value })} />
                </div>
              )}

              {form.type === "resend" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
                    <input className="input-field" placeholder="re_..." value={resendForm.apiKey} onChange={(e) => setResendForm({ ...resendForm, apiKey: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">From Address</label>
                    <input className="input-field" placeholder="alerts@yourdomain.com" value={resendForm.fromAddress} onChange={(e) => setResendForm({ ...resendForm, fromAddress: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">To Address</label>
                    <input className="input-field" placeholder="team@yourdomain.com" value={resendForm.toAddress} onChange={(e) => setResendForm({ ...resendForm, toAddress: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "gotify" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Server URL</label>
                    <input className="input-field font-mono text-sm" placeholder="https://gotify.example.com" value={gotifyForm.serverUrl} onChange={(e) => setGotifyForm({ ...gotifyForm, serverUrl: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">App Token</label>
                    <input className="input-field" placeholder="Gotify app token" value={gotifyForm.appToken} onChange={(e) => setGotifyForm({ ...gotifyForm, appToken: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                    <input className="input-field" type="number" min={1} max={10} value={gotifyForm.priority} onChange={(e) => setGotifyForm({ ...gotifyForm, priority: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "ntfy" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Server URL</label>
                    <input className="input-field font-mono text-sm" placeholder="https://ntfy.sh" value={ntfyForm.serverUrl} onChange={(e) => setNtfyForm({ ...ntfyForm, serverUrl: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Topic</label>
                    <input className="input-field" placeholder="weehawk-alerts" value={ntfyForm.topic} onChange={(e) => setNtfyForm({ ...ntfyForm, topic: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Access Token (optional)</label>
                    <input className="input-field" placeholder="Bearer token" value={ntfyForm.token} onChange={(e) => setNtfyForm({ ...ntfyForm, token: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "pushover" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">User Key</label>
                    <input className="input-field" placeholder="Pushover user key" value={pushoverForm.userKey} onChange={(e) => setPushoverForm({ ...pushoverForm, userKey: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">App Token</label>
                    <input className="input-field" placeholder="Pushover API token" value={pushoverForm.appToken} onChange={(e) => setPushoverForm({ ...pushoverForm, appToken: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Device (optional)</label>
                    <input className="input-field" placeholder="iphone-15" value={pushoverForm.device} onChange={(e) => setPushoverForm({ ...pushoverForm, device: e.target.value })} />
                  </div>
                </>
              )}

              {form.type === "stack" && (
                <>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Webhook URL</label>
                    <input className="input-field font-mono text-sm" placeholder="https://stack.example.com/hooks/..." value={stackForm.webhookUrl} onChange={(e) => setStackForm({ ...stackForm, webhookUrl: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Project / Workspace (optional)</label>
                    <input className="input-field" placeholder="core-platform" value={stackForm.project} onChange={(e) => setStackForm({ ...stackForm, project: e.target.value })} />
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={runDraftTest}
                disabled={testDraftMutation.isPending || createMutation.isPending}
                title="Runs a temporary channel test"
                className="btn-secondary text-sm border border-primary/35 text-primary flex items-center gap-2 disabled:opacity-50"
              >
                {testDraftMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                Test
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdd(false);
                    setForm({ name: "", type: "telegram" });
                    setTelegramForm({ token: "", target: "" });
                  }}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addChannel}
                  disabled={!form.name.trim() || !isPlatformValid() || createMutation.isPending}
                  className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Add Channel
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {showChannelAction && actionChannel && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} className="w-full max-w-xl glass-panel rounded-2xl border border-primary/25 p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-sm font-semibold">Channel Actions</h3>
                  <p className="text-xs text-muted-foreground mt-1">{actionChannel.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowChannelAction(false);
                    setActionMessage("");
                  }}
                  className="btn-secondary text-xs"
                >
                  Close
                </button>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Message</label>
                  <textarea className="input-field min-h-[110px] resize-none" placeholder="Write a message to send..." value={actionMessage} onChange={(e) => setActionMessage(e.target.value)} />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={runChannelTest}
                  disabled={testMutation.isPending || sendMutation.isPending}
                  className="btn-secondary text-sm border border-primary/35 text-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                  Test
                </button>
                <div className="flex items-center justify-end">
                  <button type="button" onClick={runChannelSend} disabled={sendMutation.isPending || testMutation.isPending} className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                    {sendMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Send Message
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {!loading && !listError && channels.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4"><Bell className="w-8 h-8 text-muted-foreground" /></div>
          <h3 className="font-semibold mb-1">No channels configured</h3>
          <p className="text-muted-foreground text-sm mb-5">Add your first provider to start receiving notifications.</p>
          <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 mx-auto"><Plus className="w-4 h-4" />Add Channel</button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {channels.map((ch, i) => (
              <motion.div key={ch.id} initial={false} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass-panel rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex-shrink-0"><DockerBulkCheckbox checked={channelsBulk.selected.has(ch.id)} onCheckedChange={() => channelsBulk.toggle(ch.id)} aria-label={`Select channel ${ch.name}`} /></div>
                    <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">{(() => { const meta = channelTypeMeta(ch.type); if (!meta) return <Bell className="w-5 h-5 text-primary" />; const PlatformIcon = meta.icon; return <PlatformIcon className={`w-5 h-5 ${meta.iconClass}`} />; })()}</div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap"><span className="font-semibold text-sm">{ch.name}</span><span className="text-[10px] bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5">{channelTypeLabel(ch.type)}</span></div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono"><span className="truncate">Credential: {revealedTokens.has(ch.id) ? ch.credentialPreview : "••••••••••••••••"}</span><button type="button" onClick={() => toggleReveal(ch.id)} className="hover:text-foreground transition-colors flex-shrink-0">{revealedTokens.has(ch.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}</button></div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">Target: {ch.targetPreview}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button type="button" onClick={() => openChannelActions(ch.id, ch.name)} disabled={sendMutation.isPending || testMutation.isPending} className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50" title="Send/Test actions">{sendMutation.isPending || testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}</button>
                    <button type="button" onClick={() => deleteMutation.mutate(ch.id)} disabled={deleteMutation.isPending || bulkDeleteChannelsMutation.isPending} className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
          {channelsPaged ? <ListPagination page={channelsPaged.page} totalPages={Math.max(1, Math.ceil(channelsPaged.total / channelsPaged.pageSize))} onPageChange={setChannelsPageUrl} from={channelsPaged.total > 0 ? (channelsPaged.page - 1) * channelsPaged.pageSize + 1 : 0} to={Math.min(channelsPaged.page * channelsPaged.pageSize, channelsPaged.total)} total={channelsPaged.total} /> : null}
        </>
      )}
    </AppLayout>
  );
}
