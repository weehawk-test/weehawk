"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Plus,
  Send,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  MessageCircle,
  RefreshCw,
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
  deleteNotificationChannel,
  fetchNotificationChannels,
  fetchNotificationLogs,
  sendNotification,
  testNotificationChannel,
  testTelegramCredentials,
} from "@/lib/notifications-api";

export default function Notifications() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const channelsQuery = useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: () => fetchNotificationChannels(accessToken!),
    enabled: Boolean(accessToken),
  });

  const logsQuery = useQuery({
    queryKey: ["notifications", "logs"],
    queryFn: () => fetchNotificationLogs(accessToken!),
    enabled: Boolean(accessToken),
  });

  const channels = channelsQuery.data ?? [];
  const logs = logsQuery.data ?? [];

  const [showAdd, setShowAdd] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [testForm, setTestForm] = useState({ channelId: "" });
  const [revealedTokens, setRevealedTokens] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"channels" | "logs">("channels");

  const [form, setForm] = useState({ name: "", botToken: "", chatId: "" });
  const [sendForm, setSendForm] = useState({ channelId: "", message: "" });

  const testDraftMutation = useMutation({
    mutationFn: () =>
      testTelegramCredentials(accessToken!, {
        botToken: form.botToken.trim(),
        chatId: form.chatId.trim(),
        channelName: form.name.trim() || undefined,
      }),
    onSuccess: (log) => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      if (log.status === "sent") {
        toast({ title: "Test sent", description: "Hello this is weehawk — check Telegram." });
      } else {
        toast({
          title: "Test failed",
          description: "Check bot token and chat ID.",
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createNotificationChannel(accessToken!, {
        name: form.name.trim(),
        botToken: form.botToken.trim(),
        chatId: form.chatId.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      setForm({ name: "", botToken: "", chatId: "" });
      setShowAdd(false);
      toast({ title: "Channel added", description: "Telegram channel saved." });
    },
    onError: (e: Error) => {
      toast({ title: "Could not add channel", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNotificationChannel(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "channels"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      toast({ title: "Channel removed" });
    },
    onError: (e: Error) => {
      toast({ title: "Could not remove", description: e.message, variant: "destructive" });
    },
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      sendNotification(accessToken!, {
        channelId: sendForm.channelId,
        message: sendForm.message.trim(),
      }),
    onSuccess: (log) => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      setShowSend(false);
      setSendForm({ channelId: "", message: "" });
      if (log.status === "sent") {
        toast({ title: "Message sent" });
      } else {
        toast({
          title: "Failed to send",
          description: "Check your bot token and chat ID.",
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => {
      toast({ title: "Send failed", description: e.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: (channelId: string) => testNotificationChannel(accessToken!, channelId),
    onSuccess: (log) => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "logs"] });
      setShowTest(false);
      setTestForm({ channelId: "" });
      if (log.status === "sent") {
        toast({ title: "Test sent", description: "Hello this is weehawk — check Telegram." });
      } else {
        toast({
          title: "Test failed",
          description: "Check bot token and chat ID.",
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    },
  });

  const toggleReveal = (id: string) => {
    setRevealedTokens((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const addChannel = () => {
    if (!form.name || !form.botToken || !form.chatId) return;
    createMutation.mutate();
  };

  const deleteChannel = (id: string) => deleteMutation.mutate(id);

  const sendMessage = () => {
    if (!sendForm.channelId || !sendForm.message.trim()) return;
    sendMutation.mutate();
  };

  const openTestPanel = () => {
    setTestForm({ channelId: channels.length === 1 ? channels[0].id : "" });
    setShowTest(true);
  };

  const runTest = () => {
    if (!testForm.channelId) return;
    testMutation.mutate(testForm.channelId);
  };

  /** `isPending` stays true when `enabled: false` (no token yet) — use `isLoading` (= pending && fetching). */
  const loading =
    Boolean(accessToken) &&
    (channelsQuery.isLoading || logsQuery.isLoading);

  const listError =
    Boolean(accessToken) && (channelsQuery.isError || logsQuery.isError);
  const listErrorMessage = (() => {
    const e = channelsQuery.error ?? logsQuery.error;
    return e instanceof Error ? e.message : "Could not load notifications.";
  })();

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground text-sm mt-1">Send alerts via Telegram — stored on the server.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {channels.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSend(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Send Message
            </button>
          )}
          {channels.length > 0 && (
            <button
              type="button"
              onClick={openTestPanel}
              className="btn-secondary flex items-center gap-2 border-primary/30 text-primary"
            >
              <FlaskConical className="w-4 h-4" />
              Test Telegram
            </button>
          )}
          <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Channel
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      )}

      {listError && !loading && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
          {listErrorMessage}
          <button
            type="button"
            className="ml-3 underline underline-offset-2 hover:text-destructive/90"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["notifications"] });
            }}
          >
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
              Add Telegram Channel
            </h3>
            <div className="grid grid-cols-1 gap-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Channel Name</label>
                <input
                  className="input-field"
                  placeholder="e.g. Production Alerts"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                  Bot Token
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 text-[11px]"
                  >
                    Get from BotFather <ExternalLink className="w-3 h-3" />
                  </a>
                </label>
                <input
                  className="input-field font-mono text-sm"
                  placeholder="123456789:ABCdef..."
                  value={form.botToken}
                  onChange={(e) => setForm({ ...form, botToken: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                  Chat ID
                  <span className="text-[11px] text-muted-foreground/60">Use @username or numeric ID</span>
                </label>
                <input
                  className="input-field font-mono text-sm"
                  placeholder="-1001234567890"
                  value={form.chatId}
                  onChange={(e) => setForm({ ...form, chatId: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => testDraftMutation.mutate()}
                disabled={
                  !form.botToken.trim() ||
                  !form.chatId.trim() ||
                  testDraftMutation.isPending ||
                  createMutation.isPending
                }
                title="Sends Hello this is weehawk (no need to save the channel first)"
                className="btn-secondary text-sm border border-primary/35 text-primary flex items-center gap-2 disabled:opacity-50"
              >
                {testDraftMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FlaskConical className="w-3.5 h-3.5" />
                )}
                Test
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdd(false);
                    setForm({ name: "", botToken: "", chatId: "" });
                  }}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={addChannel}
                  disabled={!form.name || !form.botToken || !form.chatId || createMutation.isPending}
                  className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Add Channel
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {showSend && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20 mb-6"
          >
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              Send Notification
            </h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Channel</label>
                <select
                  className="input-field"
                  value={sendForm.channelId}
                  onChange={(e) => setSendForm({ ...sendForm, channelId: e.target.value })}
                >
                  <option value="">Select a channel…</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Message</label>
                <textarea
                  className="input-field min-h-[80px] resize-none"
                  placeholder="Your notification message…"
                  value={sendForm.message}
                  onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowSend(false)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={sendMessage}
                disabled={
                  sendMutation.isPending || !sendForm.channelId || !sendForm.message.trim()
                }
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {sendMutation.isPending ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {showTest && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20 mb-6"
          >
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-primary" />
              Test Telegram
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Sends this fixed message:{" "}
              <span className="font-mono text-foreground">Hello this is weehawk</span>
            </p>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Channel</label>
                <select
                  className="input-field"
                  value={testForm.channelId}
                  onChange={(e) => setTestForm({ channelId: e.target.value })}
                >
                  <option value="">Select a channel…</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTest(false);
                  setTestForm({ channelId: "" });
                }}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runTest}
                disabled={testMutation.isPending || !testForm.channelId}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
              >
                {testMutation.isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <FlaskConical className="w-3.5 h-3.5" />
                    Send test
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex gap-1 p-1 bg-card/50 rounded-xl border border-white/5 w-fit mb-6">
        {[
          { id: "channels" as const, label: "Channels", count: channels.length },
          { id: "logs" as const, label: "History", count: logs.length },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === t.id && (
              <motion.div
                layoutId="notif-tab"
                className="absolute inset-0 bg-white/10 rounded-lg border border-white/10"
                initial={false}
                transition={{ type: "spring", stiffness: 400, damping: 35 }}
              />
            )}
            <span className="relative z-10">{t.label}</span>
            {t.count > 0 && (
              <span className="relative z-10 bg-primary/20 text-primary text-xs rounded-full px-1.5">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "channels" && (
          <motion.div
            key="channels"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {!loading && !listError && channels.length === 0 ? (
              <div className="glass-panel rounded-2xl p-12 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bell className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">No channels configured</h3>
                <p className="text-muted-foreground text-sm mb-5">Add a Telegram bot to start receiving notifications.</p>
                <button type="button" onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 mx-auto">
                  <Plus className="w-4 h-4" />
                  Add Channel
                </button>
              </div>
            ) : (
              channels.map((ch, i) => (
                <motion.div
                  key={ch.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-panel rounded-xl p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <MessageCircle className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-sm">{ch.name}</span>
                          <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5">
                            Telegram
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                          <span className="truncate">
                            Token: {revealedTokens.has(ch.id) ? ch.botToken : "••••••••••••••••"}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleReveal(ch.id)}
                            className="hover:text-foreground transition-colors flex-shrink-0"
                          >
                            {revealedTokens.has(ch.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
                          Chat ID: {ch.chatId}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => deleteChannel(ch.id)}
                        disabled={deleteMutation.isPending}
                        className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </motion.div>
        )}

        {tab === "logs" && (
          <motion.div key="logs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {!loading && !listError && logs.length === 0 ? (
              <div className="glass-panel rounded-2xl p-12 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">No notifications sent yet</h3>
                <p className="text-muted-foreground text-sm">Your notification history will appear here.</p>
              </div>
            ) : (
              <div className="glass-panel rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Channel
                      </th>
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Message
                      </th>
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Sent At
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, i) => (
                      <motion.tr
                        key={log.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors"
                      >
                        <td className="py-3.5 px-5">
                          {log.status === "sent" ? (
                            <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Sent
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-red-400 text-xs font-medium">
                              <XCircle className="w-3.5 h-3.5" />
                              Failed
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5">
                          <span className="text-sm text-muted-foreground">{log.channelName}</span>
                        </td>
                        <td className="py-3.5 px-5">
                          <span className="text-sm truncate max-w-xs block">{log.message}</span>
                        </td>
                        <td className="py-3.5 px-5">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(log.sentAt), "MMM d, HH:mm:ss")}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
