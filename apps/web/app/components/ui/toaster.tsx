import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[140] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={`pointer-events-auto w-80 rounded-xl border p-4 shadow-2xl ${
              toast.variant === "destructive"
                ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100"
                : "border-border bg-card text-card-foreground"
            }`}
          >
            <h4 className="mb-1 text-sm font-semibold">{toast.title}</h4>
            {toast.description && (
              <p
                className={`text-xs ${
                  toast.variant === "destructive"
                    ? "text-rose-700 dark:text-rose-200/90"
                    : "text-muted-foreground"
                }`}
              >
                {toast.description}
              </p>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
