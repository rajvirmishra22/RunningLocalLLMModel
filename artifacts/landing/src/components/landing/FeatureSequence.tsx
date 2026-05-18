import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

const STEPS = [
  {
    num: "01",
    title: "Download the weights.",
    desc: "Models are fetched once from HuggingFace directly to your browser's Cache API. Never redownload unless you clear your cache."
  },
  {
    num: "02",
    title: "Load into VRAM.",
    desc: "WebGPU allocates memory and compiles shader pipelines on the fly. No manual CUDA setup, no drivers to install."
  },
  {
    num: "03",
    title: "Generate locally.",
    desc: "Inference happens 100% on your device. Zero telemetry. Zero API keys. Total privacy."
  }
];

export function FeatureSequence() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"]
  });

  const y1 = useTransform(scrollYProgress, [0, 1], [100, -100]);
  const y2 = useTransform(scrollYProgress, [0, 1], [150, -150]);
  const y3 = useTransform(scrollYProgress, [0, 1], [200, -200]);

  return (
    <div ref={containerRef} className="py-32 relative overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-4xl md:text-6xl font-black tracking-tighter mb-20 text-center">HOW IT WORKS</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          <div className="absolute top-1/2 left-0 w-full h-[1px] bg-border hidden md:block" />
          
          <motion.div style={{ y: y1 }} className="bg-card border border-border p-8 rounded-xl relative z-10 shadow-2xl">
            <div className="text-primary font-mono text-sm mb-4">{STEPS[0].num}</div>
            <h3 className="text-2xl font-bold mb-2">{STEPS[0].title}</h3>
            <p className="text-muted-foreground">{STEPS[0].desc}</p>
          </motion.div>

          <motion.div style={{ y: y2 }} className="bg-card border border-border p-8 rounded-xl relative z-10 shadow-2xl">
            <div className="text-primary font-mono text-sm mb-4">{STEPS[1].num}</div>
            <h3 className="text-2xl font-bold mb-2">{STEPS[1].title}</h3>
            <p className="text-muted-foreground">{STEPS[1].desc}</p>
          </motion.div>

          <motion.div style={{ y: y3 }} className="bg-card border border-primary/50 shadow-[0_0_30px_hsl(var(--primary)/0.1)] p-8 rounded-xl relative z-10">
            <div className="text-primary font-mono text-sm mb-4">{STEPS[2].num}</div>
            <h3 className="text-2xl font-bold mb-2 text-white">{STEPS[2].title}</h3>
            <p className="text-muted-foreground">{STEPS[2].desc}</p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
