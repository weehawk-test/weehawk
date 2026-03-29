"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  Search, Plus, Webhook, Activity, Clock,
  TerminalSquare, MoreVertical, Trash2, Power, PowerOff
} from "lucide-react";
import { useWebhooks, useUpdateWebhook, useDeleteWebhook } from "@/hooks/use-webhooks";
import { AppLayout } from "@/components/layout/AppLayout";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/confirm/ConfirmProvider";

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data: webhooks, isLoading } = useWebhooks();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const { toast } = useToast();
  const confirm = useConfirm();

  const filteredWebhooks = webhooks?.filter(
    (w) => w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           w.script.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const handleToggleStatus = (id: string, currentStatus: boolean) => {
    updateWebhook.mutate({ id, isActive: !currentStatus }, {
      onSuccess: () => {
        toast({
          title: "Status Updated",
          description: `Webhook has been ${!currentStatus ? "activated" : "deactivated"}.`,
        });
      }
    });
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: "Delete webhook?",
      description: "This cannot be undone. Any integrations using this webhook will stop working.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    deleteWebhook.mutate(id, {
      onSuccess: () => {
        toast({
          title: "Webhook Deleted",
          description: "The webhook was successfully removed.",
        });
      },
    });
  };

  return (
    <AppLayout>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Webhooks</h1>
          <p className="text-muted-foreground">Manage and monitor your automated triggers.</p>
        </div>
        <Link href="/create">
          <button className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Create Webhook
          </button>
        </Link>
      </div>

      <div className="mb-8 relative">
        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name or script..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-field !pl-12 max-w-md bg-card/50"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredWebhooks.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-panel p-12 rounded-2xl flex flex-col items-center justify-center text-center"
        >
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
            <Webhook className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold mb-2">No webhooks found</h3>
          <p className="text-muted-foreground mb-8 max-w-md">
            {searchQuery ? "No webhooks match your search criteria." : "You haven't created any webhooks yet. Get started by creating your first automated trigger."}
          </p>
          {!searchQuery && (
            <Link href="/create">
              <button className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                Create Webhook
              </button>
            </Link>
          )}
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          <AnimatePresence>
            {filteredWebhooks.map((webhook) => (
              <motion.div
                key={webhook.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="glass-panel rounded-2xl p-6 flex flex-col group interactive-card"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${webhook.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      <Activity className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg leading-tight truncate max-w-[150px]" title={webhook.name}>
                        {webhook.name}
                      </h3>
                      <span className="text-xs text-muted-foreground font-mono flex items-center gap-1 mt-1">
                        <TerminalSquare className="w-3 h-3" /> {webhook.script}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleToggleStatus(webhook.id, webhook.isActive)}
                      className={`p-2 rounded-md hover:bg-white/10 transition-colors ${webhook.isActive ? "text-emerald-400" : "text-muted-foreground"}`}
                      title={webhook.isActive ? "Deactivate" : "Activate"}
                    >
                      {webhook.isActive ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(webhook.id)}
                      className="p-2 rounded-md hover:bg-destructive/20 text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-white/5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {format(new Date(webhook.createdAt), "MMM d, yyyy")}
                    </div>
                    <Link href={`/webhook/${webhook.id}`}>
                      <span className="text-primary hover:underline cursor-pointer font-medium">View Details &rarr;</span>
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </AppLayout>
  );
}
