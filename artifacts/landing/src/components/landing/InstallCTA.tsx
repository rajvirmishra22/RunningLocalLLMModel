import { motion } from "framer-motion";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { Button } from "@/components/ui/button";
import { MagneticWrapper } from "./MagneticWrapper";

export function InstallCTA() {
  const { status, install } = usePWAInstall();

  return (
    <div className="flex flex-col sm:flex-row items-center gap-4">
      {status.state === "available" && (
        <MagneticWrapper>
          <Button 
            size="lg" 
            onClick={install}
            className="relative group overflow-hidden bg-primary text-primary-foreground font-semibold px-8 py-6 rounded-none shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.5)] transition-all"
          >
            <span className="relative z-10">INSTALL APP</span>
            <div className="absolute inset-0 bg-white/20 translate-y-[100%] group-hover:translate-y-[0%] transition-transform duration-300" />
          </Button>
        </MagneticWrapper>
      )}

      {status.state === "installing" && (
        <Button size="lg" disabled className="font-mono rounded-none px-8 py-6 border border-primary/50 text-primary bg-transparent">
          INSTALLING...
        </Button>
      )}

      <MagneticWrapper>
        <Button 
          asChild 
          size="lg" 
          variant="outline" 
          className="font-mono rounded-none px-8 py-6 border-muted-foreground/30 hover:border-primary hover:text-primary transition-colors hover:bg-transparent"
        >
          <a href="/app/">OPEN APP IN BROWSER</a>
        </Button>
      </MagneticWrapper>

      {status.state === "unavailable" && status.reason === "ios" && (
        <p className="text-xs text-muted-foreground font-mono">
          iOS: Tap Share → Add to Home Screen
        </p>
      )}
    </div>
  );
}
