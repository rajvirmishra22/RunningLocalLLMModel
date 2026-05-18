/**
 * Tiny localStorage wrapper for the desktop app's tunable settings.
 *
 * The desktop build ships exactly one bundled model, so there's no notion of
 * "model profiles" here — just one set of generation settings. The toggle
 * `useCustom` mirrors the web app's `useCustomGeneration`: when false, the
 * chat call uses defaults and ignores the rest.
 */

export interface DesktopGenSettings {
  /** When false, chat() is called with DEFAULT_GEN values and the other
   *  fields are ignored. Casual users never need to touch the knobs. */
  useCustom: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
}

export const DEFAULT_GEN: DesktopGenSettings = {
  useCustom: false,
  temperature: 0.7,
  topP: 0.9,
  // Match the web app's DEFAULT_GENERATION so both runtimes behave the same
  // when the user hasn't opted into custom generation settings.
  maxTokens: 2048,
};

const KEY = "lms_desktop_gen";

export function loadGen(): DesktopGenSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_GEN };
    const parsed = JSON.parse(raw) as Partial<DesktopGenSettings>;
    return { ...DEFAULT_GEN, ...parsed };
  } catch {
    return { ...DEFAULT_GEN };
  }
}

export function saveGen(s: DesktopGenSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // localStorage can fail in private modes or when full — non-fatal.
  }
}

/**
 * Effective settings actually sent to the chat() Tauri command. When the user
 * hasn't opted into custom settings, the per-call values come from DEFAULT_GEN
 * rather than whatever happens to be stored.
 */
export function effectiveGen(s: DesktopGenSettings): { temperature: number; topP: number; maxTokens: number } {
  if (s.useCustom) {
    return { temperature: s.temperature, topP: s.topP, maxTokens: s.maxTokens };
  }
  return { temperature: DEFAULT_GEN.temperature, topP: DEFAULT_GEN.topP, maxTokens: DEFAULT_GEN.maxTokens };
}
