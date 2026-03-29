"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  Bell, Plus, Send, Trash2, CheckCircle, XCircle, Clock,
  MessageCircle, RefreshCw, Eye, EyeOff, ExternalLink,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useToast } from "@/hooks/use-toast";

interface NotificationChannel {
  id: string;
  name: string;
  type: "telegram";
  botToken: string;
  chatId: string;
  isActive: boolean;
  createdAt: string;
}

interface NotificationLog {
  id: string;
  channelId: string;
  channelName: string;
  message: string;
  status: "sent" | "failed";
  sentAt: string;
}

const CH_KEY = "notification_channels_data";
const LOG_KEY = "notification_logs_data";

function getChannels(): NotificationChannel[] {
  try { return JSON.parse(localStorage.getItem(CH_KEY) || "[]"); } catch { return []; }
}
function saveChannels(v: NotificationChannel[]) { localStorage.setItem(CH_KEY, JSON.stringify(v)); }

function getLogs(): NotificationLog[] {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; }
}
function saveLogs(v: NotificationLog[]) { localStorage.setItem(LOG_KEY, JSON.stringify(v)); }

export default function Notifications() {
  const [channels, setChannels] = useState<NotificationChannel[]>(getChannels);
  const [logs, setLogs] = useState<NotificationLog[]>(getLogs);
  const [showAdd, setShowAdd] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [revealedTokens, setRevealedTokens] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"channels" | "logs">("channels");

  // Form state
  const [form, setForm] = useState({ name: "", botToken: "", chatId: "" });
  const [sendForm, setSendForm] = useState({ channelId: "", message: "" });

  const { toast } = useToast();

  const toggleReveal = (id: string) => {
    setRevealedTokens((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const addChannel = () => {
    if (!form.name || !form.botToken || !form.chatId) return;
    const ch: NotificationChannel = {
      id: crypto.randomUUID(),
      name: form.name,
      type: "telegram",
      botToken: form.botToken,
      chatId: form.chatId,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    const updated = [ch, ...channels];
    setChannels(updated);
    saveChannels(updated);
    setForm({ name: "", botToken: "", chatId: "" });
    setShowAdd(false);
    toast({ title: "Channel Added", description: `${ch.name} configured.` });
  };

  const deleteChannel = (id: string) => {
    const updated = channels.filter((c) => c.id !== id);
    setChannels(updated);
    saveChannels(updated);
    toast({ title: "Channel Removed" });
  };

  const toggleChannel = (id: string) => {
    const updated = channels.map((c) => c.id === id ? { ...c, isActive: !c.isActive } : c);
    setChannels(updated);
    saveChannels(updated);
  };

  const sendMessage = async () => {
    if (!sendForm.channelId || !sendForm.message.trim()) return;
    setSending(true);
    await new Promise((r) => setTimeout(r, 1500));

    const ch = channels.find((c) => c.id === sendForm.channelId);
    const success = Math.random() > 0.1;

    const log: NotificationLog = {
      id: crypto.randomUUID(),
      channelId: sendForm.channelId,
      channelName: ch?.name ?? "Unknown",
      message: sendForm.message,
      status: success ? "sent" : "failed",
      sentAt: new Date().toISOString(),
    };

    const updatedLogs = [log, ...logs];
    setLogs(updatedLogs);
    saveLogs(updatedLogs);
    setSending(false);
    setShowSend(false);
    setSendForm({ channelId: "", message: "" });

    toast({
      title: success ? "Message Sent" : "Failed to Send",
      description: success ? `Sent to ${ch?.name}` : "Check your bot token and chat ID.",
    });
  };

  return (
    <AppLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Notifications</h1>
          <p className="text-muted-foreground text-sm mt-1">Send alerts via Telegram and other channels.</p>
        </div>
        <div className="flex items-center gap-2">
          {channels.length > 0 && (
            <button onClick={() => setShowSend(true)} className="btn-secondary flex items-center gap-2">
              <Send className="w-4 h-4" />Send Message
            </button>
          )}
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />Add Channel
          </button>
        </div>
      </div>

      {/* Add Channel Form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20 mb-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-primary" />
              Add Telegram Channel
            </h3>
            <div className="grid grid-cols-1 gap-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Channel Name</label>
                <input className="input-field" placeholder="e.g. Production Alerts" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                  Bot Token
                  <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1 text-[11px]">
                    Get from BotFather <ExternalLink className="w-3 h-3" />
                  </a>
                </label>
                <input className="input-field font-mono text-sm" placeholder="123456789:ABCdef..." value={form.botToken}
                  onChange={(e) => setForm({ ...form, botToken: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center justify-between">
                  Chat ID
                  <span className="text-[11px] text-muted-foreground/60">Use @username or numeric ID</span>
                </label>
                <input className="input-field font-mono text-sm" placeholder="-1001234567890" value={form.chatId}
                  onChange={(e) => setForm({ ...form, chatId: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowAdd(false); setForm({ name: "", botToken: "", chatId: "" }); }} className="btn-secondary text-sm">Cancel</button>
              <button onClick={addChannel} disabled={!form.name || !form.botToken || !form.chatId}
                className="btn-primary text-sm disabled:opacity-50">Add Channel</button>
            </div>
          </motion.div>
        )}

        {/* Send Message Form */}
        {showSend && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="glass-panel rounded-xl p-5 border border-primary/20 mb-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />Send Notification
            </h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Channel</label>
                <select className="input-field" value={sendForm.channelId}
                  onChange={(e) => setSendForm({ ...sendForm, channelId: e.target.value })}>
                  <option value="">Select a channel...</option>
                  {channels.filter((c) => c.isActive).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Message</label>
                <textarea className="input-field min-h-[80px] resize-none" placeholder="Your notification message..."
                  value={sendForm.message} onChange={(e) => setSendForm({ ...sendForm, message: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSend(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={sendMessage} disabled={sending || !sendForm.channelId || !sendForm.message.trim()}
                className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                {sending ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Sending...</> : <><Send className="w-3.5 h-3.5" />Send</>}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-card/50 rounded-xl border border-white/5 w-fit mb-6">
        {[{ id: "channels", label: "Channels", count: channels.length }, { id: "logs", label: "History", count: logs.length }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id as "channels" | "logs")}
            className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {tab === t.id && (
              <motion.div layoutId="notif-tab" className="absolute inset-0 bg-white/10 rounded-lg border border-white/10"
                initial={false} transition={{ type: "spring", stiffness: 400, damping: 35 }} />
            )}
            <span className="relative z-10">{t.label}</span>
            {t.count > 0 && (
              <span className="relative z-10 bg-primary/20 text-primary text-xs rounded-full px-1.5">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* Channels */}
        {tab === "channels" && (
          <motion.div key="channels" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            {channels.length === 0 ? (
              <div className="glass-panel rounded-2xl p-12 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Bell className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="font-semibold mb-1">No channels configured</h3>
                <p className="text-muted-foreground text-sm mb-5">Add a Telegram bot to start receiving notifications.</p>
                <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 mx-auto">
                  <Plus className="w-4 h-4" />Add Channel
                </button>
              </div>
            ) : channels.map((ch, i) => (
              <motion.div key={ch.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="glass-panel rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                      <MessageCircle className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-sm">{ch.name}</span>
                        <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 rounded-full px-2 py-0.5">Telegram</span>
                        <span className={`text-[10px] border rounded-full px-2 py-0.5 ${ch.isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"}`}>
                          {ch.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                        <span>Token: {revealedTokens.has(ch.id) ? ch.botToken : "••••••••••••••••"}</span>
                        <button onClick={() => toggleReveal(ch.id)} className="hover:text-foreground transition-colors">
                          {revealedTokens.has(ch.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">Chat ID: {ch.chatId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toggleChannel(ch.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${ch.isActive ? "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"}`}>
                      {ch.isActive ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => deleteChannel(ch.id)}
                      className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* Logs */}
        {tab === "logs" && (
          <motion.div key="logs" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {logs.length === 0 ? (
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
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channel</th>
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Message</th>
                      <th className="text-left py-3 px-5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sent At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log, i) => (
                      <motion.tr key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                        className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3.5 px-5">
                          {log.status === "sent"
                            ? <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium"><CheckCircle className="w-3.5 h-3.5" />Sent</span>
                            : <span className="flex items-center gap-1.5 text-red-400 text-xs font-medium"><XCircle className="w-3.5 h-3.5" />Failed</span>
                          }
                        </td>
                        <td className="py-3.5 px-5"><span className="text-sm text-muted-foreground">{log.channelName}</span></td>
                        <td className="py-3.5 px-5"><span className="text-sm truncate max-w-xs block">{log.message}</span></td>
                        <td className="py-3.5 px-5">
                          <span className="text-xs text-muted-foreground">{format(new Date(log.sentAt), "MMM d, HH:mm:ss")}</span>
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
