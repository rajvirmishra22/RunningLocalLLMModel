// Web-build stub for `@tauri-apps/api/core`.
//
// `Settings.tsx` is shared between the web app and the desktop (Tauri) build.
// It dynamically imports `@tauri-apps/api/core` for desktop-only features
// (the Local Vision Helper), always gated behind `isCustomCatalogSupported()`
// so the import never executes in the browser. The web build has no Tauri
// runtime and does not depend on `@tauri-apps/api`, so Vite cannot resolve the
// bare specifier — which previously crashed the whole web app with a 500.
//
// The web Vite config aliases `@tauri-apps/api/core` to this stub so the build
// resolves cleanly while keeping Tauri entirely out of the web bundle. The
// desktop build uses its own Vite config and resolves the real package. If
// this `invoke` is ever reached on web (it shouldn't be), it fails loudly.
export function invoke<T = unknown>(cmd: string): Promise<T> {
  return Promise.reject(
    new Error(`Tauri command "${cmd}" is not available in the browser build`),
  );
}
