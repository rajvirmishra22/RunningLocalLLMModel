export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // In dev (Vite HMR) we still register so beforeinstallprompt can fire.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[pwa] SW registration failed", err);
    });
  });
}
