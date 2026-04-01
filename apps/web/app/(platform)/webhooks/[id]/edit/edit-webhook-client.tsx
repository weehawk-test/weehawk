"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUpdateWebhook } from "@/hooks/use-webhooks";
import type { WebhookDetail } from "@/lib/webhooks-api";
import type { NotificationChannel } from "@/lib/notifications-api";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Props = {
  id: string;
  initialWebhook: WebhookDetail;
  initialChannels: NotificationChannel[];
};

export function EditWebhookClient({ id, initialWebhook, initialChannels }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const updateMutation = useUpdateWebhook();

  const [name, setName] = useState(initialWebhook.name);
  const [description, setDescription] = useState(initialWebhook.description ?? "");
  const [notifyChannelId, setNotifyChannelId] = useState(initialWebhook.notifyChannelId ?? "");
  const [notifyMessage, setNotifyMessage] = useState(initialWebhook.notifyMessage ?? "");

  const submit = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const hasNotifyChannel = Boolean(notifyChannelId.trim());
    const hasNotifyMessage = Boolean(notifyMessage.trim());
    if (hasNotifyChannel !== hasNotifyMessage) {
      toast({ title: "Choose channel and message together", variant: "destructive" });
      return;
    }

    updateMutation.mutate(
      {
        id,
        name: name.trim(),
        description: description.trim(),
        notifyChannelId: hasNotifyChannel ? notifyChannelId : null,
        notifyMessage: hasNotifyMessage ? notifyMessage.trim() : null,
      },
      {
        onSuccess: () => router.push(`/webhooks/${id}`),
        onError: (e: Error) =>
          toast({ title: "Could not update webhook", description: e.message, variant: "destructive" }),
      },
    );
  };

  return (
    <>
      <div className="max-w-2xl mx-auto">
        <Link href="/webhooks">
          <button type="button" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to webhooks
          </button>
        </Link>

        <div className="glass-panel p-6 md:p-8 rounded-2xl">
          <h1 className="text-2xl font-bold text-foreground mb-6">Edit webhook</h1>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name</label>
              <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Description</label>
              <textarea className="input-field min-h-[80px] resize-y" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="rounded-xl border border-white/10 p-4 space-y-3">
              <p className="text-sm font-medium">Optional notification</p>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notification channel</label>
                <select className="input-field" value={notifyChannelId} onChange={(e) => setNotifyChannelId(e.target.value)}>
                  <option value="">No notification</option>
                  {initialChannels.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Message content</label>
                <textarea className="input-field min-h-[80px] resize-y" value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Link href="/webhooks"><button type="button" className="btn-secondary">Cancel</button></Link>
              <button type="button" onClick={submit} disabled={updateMutation.isPending} className="btn-primary">
                {updateMutation.isPending ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
