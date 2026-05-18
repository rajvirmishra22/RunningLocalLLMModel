import { motion, useInView, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  
  const spring = useSpring(0, {
    duration: 2000,
    bounce: 0,
  });
  
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (isInView) {
      spring.set(value);
    }
  }, [isInView, spring, value]);

  useEffect(() => {
    return spring.on("change", (latest) => {
      setDisplay(Math.floor(latest));
    });
  }, [spring]);

  return (
    <span ref={ref} className="font-mono">
      {display}{suffix}
    </span>
  );
}

export function LiveStats() {
  return (
    <section className="py-32 relative overflow-hidden bg-black border-y border-border">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,255,255,0.05)_0%,transparent_70%)] pointer-events-none" />
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center">
          <div className="p-8">
            <div className="text-6xl font-black text-primary mb-4 drop-shadow-[0_0_15px_hsl(var(--primary)/0.3)]">
              <AnimatedNumber value={120} suffix="+" />
            </div>
            <div className="text-lg text-muted-foreground font-mono">TOKENS / SEC</div>
            <div className="text-sm text-muted-foreground/50 mt-2">M3 Max Performance</div>
          </div>
          <div className="p-8 border-x border-border/50">
            <div className="text-6xl font-black text-secondary mb-4 drop-shadow-[0_0_15px_hsl(var(--secondary)/0.3)]">
              <AnimatedNumber value={0} />
            </div>
            <div className="text-lg text-muted-foreground font-mono">SERVERS USED</div>
            <div className="text-sm text-muted-foreground/50 mt-2">100% Client-Side</div>
          </div>
          <div className="p-8">
            <div className="text-6xl font-black text-white mb-4">
              <AnimatedNumber value={8} suffix="B" />
            </div>
            <div className="text-lg text-muted-foreground font-mono">PARAMETERS</div>
            <div className="text-sm text-muted-foreground/50 mt-2">Llama 3.1 Ready</div>
          </div>
        </div>
      </div>
    </section>
  );
}
