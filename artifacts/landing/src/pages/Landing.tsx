import { motion } from "framer-motion";
import { ProgressBar } from "@/components/landing/ProgressBar";
import { InstallCTA } from "@/components/landing/InstallCTA";
import { HeroTerminal } from "@/components/landing/HeroTerminal";
import { WebGPUDetector } from "@/components/landing/WebGPUDetector";
import { ModelStatsPicker } from "@/components/landing/ModelStatsPicker";
import { FeatureSequence } from "@/components/landing/FeatureSequence";
import { LiveStats } from "@/components/landing/LiveStats";
import { PrivacySection } from "@/components/landing/PrivacySection";

export default function Landing() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground overflow-hidden selection:bg-primary/30 selection:text-primary relative">
      <ProgressBar />
      
      <main>
        {/* HERO SECTION */}
        <section className="relative min-h-[95vh] flex flex-col items-center justify-center px-6 pt-24 pb-12 overflow-hidden">
          {/* Background effects */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_center,rgba(0,255,255,0.08)_0%,transparent_60%)] pointer-events-none" />
          
          <div className="z-10 w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="flex flex-col text-left">
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <div className="inline-block px-3 py-1 mb-6 rounded-full border border-primary/30 bg-primary/10 text-primary font-mono text-xs tracking-wider">
                  WEBGPU NATIVE
                </div>
                <h1 className="text-5xl sm:text-7xl font-black tracking-tighter text-white mb-6 drop-shadow-[0_0_10px_rgba(255,255,255,0.1)] leading-[0.9]">
                  YOUR <span className="text-primary">MODELS.</span><br/>
                  YOUR <span className="text-primary">HARDWARE.</span>
                </h1>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="max-w-xl mb-10"
              >
                <p className="text-xl text-muted-foreground font-medium leading-relaxed">
                  A self-contained AI studio running completely offline in your browser. 
                  Zero telemetry. Zero API costs. Maximum privacy.
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
              >
                <InstallCTA />
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="relative w-full"
            >
              <HeroTerminal />
              <div className="absolute -bottom-6 -right-6 w-full max-w-sm hidden sm:block">
                <WebGPUDetector />
              </div>
            </motion.div>
          </div>
        </section>

        {/* IMAGE BREAK */}
        <section className="py-20 relative z-20">
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="w-full max-w-6xl mx-auto px-6 relative"
          >
            <div className="relative rounded-2xl overflow-hidden border border-primary/20 shadow-[0_0_100px_hsl(var(--primary)/0.15)] bg-black">
              <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 pointer-events-none" />
              <img 
                src="/hero-app-mockup.png" 
                alt="LocalModel Studio Interface" 
                className="w-full h-auto object-cover opacity-90"
              />
            </div>
          </motion.div>
        </section>

        {/* STATS & MODELS */}
        <LiveStats />
        
        <section className="py-24 bg-card/30 border-b border-border">
          <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tighter mb-6">BRING YOUR OWN ENGINE.</h2>
              <p className="text-xl text-muted-foreground mb-8">
                Choose the right balance of speed and intelligence. Switch models instantly — they cache in your browser for immediate load times on the next run.
              </p>
            </div>
            <ModelStatsPicker />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <FeatureSequence />

        {/* PRIVACY */}
        <PrivacySection />

        {/* FINAL CTA */}
        <section className="py-32 relative overflow-hidden flex items-center justify-center text-center px-6">
          <div className="absolute inset-0 bg-primary/5" />
          <div className="absolute w-[500px] h-[500px] bg-primary/20 blur-[100px] rounded-full top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
          
          <div className="relative z-10 max-w-2xl flex flex-col items-center">
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-6">READY TO RUN?</h2>
            <p className="text-xl text-muted-foreground mb-12">
              Install the app now and start generating. No accounts required.
            </p>
            <InstallCTA />
          </div>
        </section>
      </main>

      <footer className="py-8 border-t border-border bg-background text-center relative z-20">
        <p className="text-muted-foreground font-mono text-sm">
          LOCALMODEL STUDIO // BROWSER-NATIVE AI // {new Date().getFullYear()}
        </p>
      </footer>
    </div>
  );
}
