import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={`pointer-events-auto w-80 p-4 rounded-xl shadow-2xl backdrop-blur-md border ${
              toast.variant === 'destructive' 
                ? 'bg-destructive/10 border-destructive/20 text-destructive' 
                : 'bg-card/90 border-white/10 text-foreground'
            }`}
          >
            <h4 className="font-semibold text-sm mb-1">{toast.title}</h4>
            {toast.description && (
              <p className="text-xs opacity-80">{toast.description}</p>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
