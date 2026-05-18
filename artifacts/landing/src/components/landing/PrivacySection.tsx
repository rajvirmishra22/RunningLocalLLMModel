import { motion } from "framer-motion";

export function PrivacySection() {
  return (
    <section className="py-32 relative overflow-hidden bg-background">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        <div className="order-2 lg:order-1 relative h-[400px] flex items-center justify-center">
          {/* Abstract lock / privacy visual */}
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div 
              animate={{ rotate: 360 }} 
              transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
              className="w-64 h-64 border border-dashed border-primary/30 rounded-full"
            />
            <motion.div 
              animate={{ rotate: -360 }} 
              transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
              className="absolute w-48 h-48 border border-secondary/30 rounded-full"
            />
            <div className="absolute w-32 h-32 bg-card border border-primary/50 shadow-[0_0_50px_hsl(var(--primary)/0.2)] rounded-2xl flex flex-col items-center justify-center p-4">
              <div className="text-xs font-mono text-primary mb-2">ENCLAVE</div>
              <div className="w-12 h-12 rounded bg-black border border-primary/30 relative overflow-hidden">
                <motion.div 
                  animate={{ y: ["-100%", "100%"] }} 
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 bg-primary/20"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter mb-6 text-white">
            WHAT HAPPENS LOCAL, <br/>STAYS LOCAL.
          </h2>
          <p className="text-xl text-muted-foreground mb-6">
            There is no backend. There is no API key. There is no database. Your conversations are processed locally by your GPU and stored in your browser's IndexedDB. 
          </p>
          <ul className="space-y-4 text-muted-foreground font-mono text-sm">
            <li className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 bg-primary rounded-full" />
              <span>Offline-first architecture</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 bg-primary rounded-full" />
              <span>IndexedDB storage only</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 bg-primary rounded-full" />
              <span>Zero telemetry or analytics</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
