import { Button } from "@/components/ui/button";
import { MagneticWrapper } from "./MagneticWrapper";

// Replace this with the real signed Windows installer URL once the .exe is built
// (e.g. via `cargo tauri build` in the desktop/ project, then uploaded to a CDN
// or GitHub Releases). Until then the button is disabled and shows "Coming soon".
const WINDOWS_INSTALLER_URL = "";

export function InstallCTA() {
  const hasRelease = WINDOWS_INSTALLER_URL.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
        <MagneticWrapper>
          {hasRelease ? (
            <Button
              asChild
              size="lg"
              className="relative group overflow-hidden bg-primary text-primary-foreground font-semibold px-8 py-6 rounded-none shadow-[0_0_20px_hsl(var(--primary)/0.3)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.5)] transition-all"
            >
              <a href={WINDOWS_INSTALLER_URL} download>
                <span className="relative z-10 flex items-center gap-2 font-mono tracking-wider">
                  DOWNLOAD FOR WINDOWS
                </span>
                <div className="absolute inset-0 bg-white/20 translate-y-[100%] group-hover:translate-y-[0%] transition-transform duration-300" />
              </a>
            </Button>
          ) : (
            <Button
              size="lg"
              disabled
              className="relative bg-primary/40 text-primary-foreground font-semibold px-8 py-6 rounded-none cursor-not-allowed font-mono tracking-wider"
              title="Windows build not yet published"
            >
              WINDOWS .EXE — COMING SOON
            </Button>
          )}
        </MagneticWrapper>

        <MagneticWrapper>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="font-mono rounded-none px-8 py-6 border-muted-foreground/30 hover:border-primary hover:text-primary transition-colors hover:bg-transparent tracking-wider"
          >
            <a href="/app/">TRY IN BROWSER</a>
          </Button>
        </MagneticWrapper>
      </div>

      <p className="text-xs text-muted-foreground font-mono">
        Windows 10/11 · 64-bit · ~450 MB · ships with a starter model, no extra downloads.
      </p>
    </div>
  );
}
