import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

export type PWAInstallStatus =
  | { state: "unavailable"; reason: "ios" | "installed" | "unsupported" | "checking" | "dismissed" }
  | { state: "available" }
  | { state: "installing" }
  | { state: "installed" };

/**
 * Hook for triggering the PWA install prompt.
 *
 * - On Chrome/Edge/desktop, returns `available` once the browser fires `beforeinstallprompt`.
 *   Calling `install()` shows the native install dialog.
 * - On iOS Safari, returns `unavailable` with reason `"ios"` — the caller should show
 *   manual "Add to Home Screen" instructions.
 * - On browsers that don't support PWA install (Firefox desktop, some older browsers),
 *   returns `unavailable` with reason `"unsupported"`.
 */
export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [status, setStatus] = useState<PWAInstallStatus>({ state: "unavailable", reason: "checking" });

  useEffect(() => {
    // Detect if already installed (running in standalone)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      // @ts-expect-error legacy iOS property
      window.navigator.standalone === true;

    if (isStandalone) {
      setStatus({ state: "installed" });
      return;
    }

    // iOS Safari has no beforeinstallprompt; needs manual A2HS
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    if (isIOS) {
      setStatus({ state: "unavailable", reason: "ios" });
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setStatus({ state: "available" });
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setStatus({ state: "installed" });
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // If the prompt never fires within ~3s we treat as unsupported (Firefox/no-SW).
    const fallback = window.setTimeout(() => {
      setStatus((cur) =>
        cur.state === "unavailable" && cur.reason === "checking"
          ? { state: "unavailable", reason: "unsupported" }
          : cur
      );
    }, 3000);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.clearTimeout(fallback);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return { outcome: "dismissed" as const };
    setStatus({ state: "installing" });
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    // The browser consumes the prompt event after .prompt() — it cannot be reused.
    // If the user dismisses, we must drop back to "unavailable/dismissed" until
    // (and only if) the browser re-fires beforeinstallprompt later.
    setDeferredPrompt(null);
    if (choice.outcome === "accepted") {
      setStatus({ state: "installed" });
    } else {
      setStatus({ state: "unavailable", reason: "dismissed" });
    }
    return choice;
  }, [deferredPrompt]);

  return { status, install };
}
