import { useState, useEffect } from "react";
import { motion } from "framer-motion";

export function WebGPUDetector() {
  const [status, setStatus] = useState<"checking" | "supported" | "unsupported">("checking");
  const [adapterInfo, setAdapterInfo] = useState<string>("");

  useEffect(() => {
    async function checkWebGPU() {
      if (!navigator.gpu) {
        setStatus("unsupported");
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          setStatus("supported");
          // Some browsers expose name, others don't, fallback to generic
          const name = (adapter as any).name || "Default WebGPU Adapter";
          setAdapterInfo(name);
        } else {
          setStatus("unsupported");
        }
      } catch (e) {
        setStatus("unsupported");
      }
    }
    checkWebGPU();
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      className="p-6 rounded-xl border border-border bg-card relative overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <h3 className="text-xl font-mono text-foreground mb-2 flex items-center gap-2">
        <span>Hardware Check</span>
      </h3>
      {status === "checking" && <p className="text-muted-foreground font-mono">Querying navigator.gpu...</p>}
      {status === "supported" && (
        <div>
          <div className="text-primary font-mono mb-2 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            WebGPU Engine Ready
          </div>
          <p className="text-sm text-muted-foreground font-mono">Adapter: {adapterInfo}</p>
        </div>
      )}
      {status === "unsupported" && (
        <div className="text-destructive font-mono">
          WebGPU Unavailable. Browser update required.
        </div>
      )}
    </motion.div>
  );
}
