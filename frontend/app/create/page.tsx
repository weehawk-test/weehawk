"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createWebhookSchema, CreateWebhookInput } from "@/lib/schema";
import { useCreateWebhook } from "@/hooks/use-webhooks";
import { AppLayout } from "@/components/layout/AppLayout";
import { ArrowLeft, Terminal, Type, AlignLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";

const PREDEFINED_SCRIPTS = [
  "deploy.sh",
  "restart-services.sh",
  "clear-cache.sh",
  "notify-slack.py",
  "db-backup.sh",
];

export default function CreateWebhook() {
  const router = useRouter();
  const createMutation = useCreateWebhook();
  const [isCustomScript, setIsCustomScript] = useState(false);
  const tempUuid = crypto.randomUUID(); // For preview purposes

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<CreateWebhookInput>({
    resolver: zodResolver(createWebhookSchema),
    defaultValues: {
      script: PREDEFINED_SCRIPTS[0],
    }
  });

  const watchScript = watch("script");

  const onSubmit = (data: CreateWebhookInput) => {
    createMutation.mutate(data, {
      onSuccess: (newWebhook) => {
        router.push(`/webhook/${newWebhook.id}`);
      }
    });
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <Link href="/webhooks">
          <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8 text-sm font-medium">
            <ArrowLeft className="w-4 h-4" /> Back to webhooks
          </button>
        </Link>

        <div className="glass-panel p-8 md:p-10 rounded-2xl relative overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[80px] pointer-events-none" />

          <div className="mb-10">
            <h1 className="text-3xl font-bold text-foreground mb-2">Create New Webhook</h1>
            <p className="text-muted-foreground">Configure a new endpoint to trigger your server scripts.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 relative z-10">
            
            {/* Section 1: Basic Info */}
            <div className="space-y-6">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <Type className="w-4 h-4 text-primary" /> Webhook Name
                </label>
                <input
                  {...register("name")}
                  className="input-field"
                  placeholder="e.g., Production Deploy Trigger"
                />
                {errors.name && <p className="text-destructive text-sm mt-1">{errors.name.message}</p>}
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
                  <AlignLeft className="w-4 h-4 text-primary" /> Description <span className="text-muted-foreground font-normal">(Optional)</span>
                </label>
                <textarea
                  {...register("description")}
                  className="input-field min-h-[100px] resize-none"
                  placeholder="What does this webhook do?"
                />
              </div>
            </div>

            <hr className="border-border" />

            {/* Section 2: Execution */}
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Terminal className="w-4 h-4 text-primary" /> Target Script
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomScript(!isCustomScript);
                      setValue("script", isCustomScript ? PREDEFINED_SCRIPTS[0] : "");
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {isCustomScript ? "Select from list" : "Enter custom script"}
                  </button>
                </div>
                
                {isCustomScript ? (
                  <input
                    {...register("script")}
                    className="input-field font-mono text-sm"
                    placeholder="e.g., custom-script.sh"
                  />
                ) : (
                  <select
                    {...register("script")}
                    className="input-field appearance-none cursor-pointer"
                  >
                    {PREDEFINED_SCRIPTS.map(script => (
                      <option key={script} value={script} className="bg-card text-foreground">{script}</option>
                    ))}
                  </select>
                )}
                {errors.script && <p className="text-destructive text-sm mt-1">{errors.script.message}</p>}
              </div>

              {/* Preview */}
              <div className="bg-black/50 border border-white/5 rounded-xl p-5 relative overflow-hidden">
                <ShieldCheck className="absolute -bottom-4 -right-4 w-24 h-24 text-primary/5" />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Generated Endpoint Preview</h4>
                
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="w-20 text-muted-foreground">UUID:</span>
                    <span className="font-mono text-foreground">{tempUuid}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="w-20 text-muted-foreground">Method:</span>
                    <span className="font-mono text-emerald-400 font-bold">POST</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="w-20 text-muted-foreground">URL:</span>
                    <span className="font-mono text-primary truncate">https://api.nexus.dev/hooks/{tempUuid}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-4">
              <Link href="/webhooks">
                <button type="button" className="btn-secondary">Cancel</button>
              </Link>
              <button 
                type="submit" 
                disabled={createMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {createMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Webhook"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
