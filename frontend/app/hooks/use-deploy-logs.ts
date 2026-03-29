import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { DeployLog, deployLogSchema } from "@/lib/schema";
import { z } from "zod";
import { executeServiceDeploymentApi } from "@/lib/services-api";

const STORAGE_KEY = "deploy_logs_data";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getStored = (): DeployLog[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    return z.array(deployLogSchema).parse(JSON.parse(data));
  } catch {
    return [];
  }
};
const save = (items: DeployLog[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(items));

/** Text to show in the log viewer: raw Docker output, or legacy `lines` joined. */
export function getDeployLogText(log: DeployLog): string {
  if (log.rawOutput != null && log.rawOutput.length > 0) return log.rawOutput;
  return log.lines.map((l) => l.msg).join("\n");
}

export function useDeployLogs(serviceId?: string) {
  return useQuery({
    queryKey: ["deploy-logs", serviceId],
    queryFn: async () => {
      await delay(150);
      const all = getStored();
      const filtered = serviceId ? all.filter((l) => l.serviceId === serviceId) : all;
      return filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    },
  });
}

/** Runs `POST /services/:id/execute` on the API; persists verbatim output for the Deployments tab. */
export function useDeploy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serviceId,
      serviceName,
      mode = "deploy",
    }: {
      serviceId: string;
      serviceName: string;
      serviceType: string;
      mode?: "deploy" | "reload";
    }) => {
      const id = crypto.randomUUID();
      const startedAt = new Date().toISOString();

      try {
        const result = await executeServiceDeploymentApi(serviceId, mode);
        const finishedAt = new Date().toISOString();
        const rawOutput = (result.output ?? "").replace(/\r\n/g, "\n");

        const log: DeployLog = {
          id,
          serviceId,
          status: result.success ? "success" : "failed",
          trigger: "manual",
          startedAt,
          finishedAt,
          rawOutput,
          lines: [],
        };

        const existing = getStored();
        save([log, ...existing]);
        return log;
      } catch (e) {
        const finishedAt = new Date().toISOString();
        const errMsg = e instanceof Error ? e.message : String(e);
        const log: DeployLog = {
          id,
          serviceId,
          status: "failed",
          trigger: "manual",
          startedAt,
          finishedAt,
          rawOutput: errMsg,
          lines: [],
        };
        const existing = getStored();
        save([log, ...existing]);
        return log;
      }
    },
    onSuccess: (log) => {
      qc.invalidateQueries({ queryKey: ["deploy-logs", log.serviceId] });
      qc.invalidateQueries({ queryKey: ["service", log.serviceId] });
      qc.invalidateQueries({ queryKey: ["service-runtime", log.serviceId] });
      qc.invalidateQueries({ queryKey: ["services"] });
    },
  });
}

export function useDeleteDeployLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const items = getStored();
      const item = items.find((l) => l.id === id);
      save(items.filter((l) => l.id !== id));
      return item;
    },
    onSuccess: (item) => {
      if (item) qc.invalidateQueries({ queryKey: ["deploy-logs", item.serviceId] });
    },
  });
}
