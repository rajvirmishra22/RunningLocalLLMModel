import { useEffect, useRef, useState } from "react";
import { chat, cancelChat, initModel, onToken, type ModelInfo } from "./api";
import { loadGen, saveGen, effectiveGen, DEFAULT_GEN, type DesktopGenSettings } from "./storage";
import {
  DESKTOP_CAPS,
  recommendDesktop,
  applyRecommendation,
  profileLabel,
  readHardware,
  type OptProfile,
  type DesktopRecommendation,
} from "./tuning";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export default function App() {
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [gen, setGen] = useState<DesktopGenSettings>(() => loadGen());
  const [tuningOpen, setTuningOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initModel()
      .then(setModel)
      .catch((e: unknown) => setLoadError(String(e)));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onToken((tok) => setStreaming((s) => s + tok)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // Persist gen settings whenever they change. The toggle defaults to off, so
  // first-time users never see the knobs at all.
  useEffect(() => {
    saveGen(gen);
  }, [gen]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !model) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    setStreaming("");
    try {
      const opts = effectiveGen(gen);
      const full = await chat(text, opts);
      setMessages((m) => [...m, { role: "assistant", content: full }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${String(e)}` }]);
    } finally {
      setStreaming("");
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">LocalModel Studio</div>
        <div className="topbar-right">
          <div className="status">
            {loadError && <span className="err">Failed: {loadError}</span>}
            {!loadError && !model && <span className="dim">Loading model…</span>}
            {model && <span className="ok">{model.name} · ready</span>}
          </div>
          <button
            className="tune-btn"
            onClick={() => setTuningOpen(true)}
            title="Open Model Tuning — pick generation settings or run the optimizer"
          >
            <span className="tune-icon">✦</span>
            Optimize / Tune
          </button>
        </div>
      </header>

      <main className="messages" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <div className="empty">
            <h2>Local. Private. Yours.</h2>
            <p>This app runs entirely on your machine. Nothing is sent anywhere.</p>
            <button className="empty-cta" onClick={() => setTuningOpen(true)}>
              ✦ Optimize Model
            </button>
            <p className="empty-hint">
              Pick how you want the model to behave — Balanced, Max Quality, Low Memory, or Fastest.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="role">{m.role}</div>
            <div className="content">{m.content}</div>
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            <div className="role">assistant</div>
            <div className="content">
              {streaming}
              <span className="caret">▍</span>
            </div>
          </div>
        )}
      </main>

      <footer className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={model ? "Send a message…" : "Waiting for model…"}
          disabled={!model || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button onClick={() => void cancelChat()} className="cancel">Stop</button>
        ) : (
          <button onClick={() => void send()} disabled={!model || !input.trim()}>Send</button>
        )}
      </footer>

      {tuningOpen && (
        <TuningPanel
          gen={gen}
          onClose={() => setTuningOpen(false)}
          onChange={setGen}
          modelName={model?.name ?? "the bundled model"}
        />
      )}
    </div>
  );
}

function TuningPanel({
  gen,
  onClose,
  onChange,
  modelName,
}: {
  gen: DesktopGenSettings;
  onClose: () => void;
  onChange: (next: DesktopGenSettings) => void;
  modelName: string;
}) {
  const [profile, setProfile] = useState<OptProfile>("balanced");
  const [rec, setRec] = useState<DesktopRecommendation | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const hw = readHardware();

  function runOptimizer() {
    setRec(recommendDesktop(profile));
    setStatus(null);
  }

  function apply() {
    if (!rec) return;
    onChange(applyRecommendation(rec));
    setStatus(`Applied. Custom generation settings are now on.`);
  }

  function resetToDefaults() {
    onChange({ ...DEFAULT_GEN });
    setRec(null);
    setStatus("Reset to defaults. Custom generation settings turned off.");
  }

  return (
    <div className="tuning-backdrop" onClick={onClose}>
      <div className="tuning-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tuning-header">
          <h2>Model Tuning</h2>
          <button className="tuning-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className="tuning-sub">
          Adjust generation settings or run the optimizer to get sensible values for {modelName}.
        </p>

        {/* Hardware row */}
        <section className="tuning-section">
          <h3>Hardware</h3>
          <div className="tuning-grid">
            <Info label="Platform" value={hw.platform} />
            <Info label="CPU threads" value={String(hw.cpuThreads)} />
            <Info label="RAM" value={hw.ramGb ? `~${hw.ramGb} GB (approximate)` : "Unknown"} />
            <Info label="Model" value={modelName} mono />
          </div>
          <p className="tuning-note">
            Native inference runs on llama.cpp with GPU offload when your build supports it. Exact VRAM isn't
            readable from the webview, so the optimizer recommends by intent rather than guessing memory.
          </p>
        </section>

        {/* Optimizer */}
        <section className="tuning-section">
          <h3>✦ Optimize Model</h3>
          <div className="tuning-row">
            <label className="tuning-label">
              Profile
              <select value={profile} onChange={(e) => setProfile(e.target.value as OptProfile)}>
                <option value="balanced">Balanced — best all-rounder</option>
                <option value="max-quality">Max Quality — most deterministic</option>
                <option value="low-memory">Low Memory — keep memory low</option>
                <option value="fastest">Fastest — quickest replies</option>
              </select>
            </label>
            <button className="tuning-primary" onClick={runOptimizer}>Recommend</button>
          </div>

          {rec && (
            <div className="rec-card">
              <div className="rec-title">{profileLabel(rec.profile)} settings</div>
              <div className="rec-chips">
                <span><em>temp</em>={rec.gen.temperature}</span>
                <span><em>top_p</em>={rec.gen.topP}</span>
                <span><em>max_t</em>={rec.gen.maxTokens}</span>
              </div>
              {rec.reasoning.map((r, i) => (
                <p key={i} className="rec-reason">• {r}</p>
              ))}
              {rec.warnings.map((w, i) => (
                <p key={i} className="rec-warn">⚠ {w}</p>
              ))}
              <button className="tuning-primary" onClick={apply}>Apply recommendation</button>
              {status && <p className="rec-status">✓ {status}</p>}
            </div>
          )}
        </section>

        {/* Manual generation settings — gated behind a toggle so casual users
            never have to see the knobs. */}
        <section className="tuning-section">
          <h3>Generation Settings</h3>
          <label className="tuning-toggle">
            <input
              type="checkbox"
              checked={gen.useCustom}
              onChange={(e) => onChange({ ...gen, useCustom: e.target.checked })}
            />
            <span>Use custom generation settings</span>
            <span className="tuning-toggle-sub">
              {gen.useCustom
                ? "Using the values below."
                : `Off — chat uses defaults (temp ${DEFAULT_GEN.temperature}, top-p ${DEFAULT_GEN.topP}, max ${DEFAULT_GEN.maxTokens}).`}
            </span>
          </label>

          {gen.useCustom && (
            <div className="tuning-grid">
              <NumberInput
                label="Temperature"
                value={gen.temperature}
                step={0.1}
                min={0}
                max={2}
                onChange={(v) => onChange({ ...gen, temperature: v })}
              />
              <NumberInput
                label="Top-p"
                value={gen.topP}
                step={0.05}
                min={0}
                max={1}
                onChange={(v) => onChange({ ...gen, topP: v })}
              />
              <NumberInput
                label="Max tokens"
                value={gen.maxTokens}
                step={128}
                min={1}
                max={8192}
                onChange={(v) => onChange({ ...gen, maxTokens: v })}
              />
            </div>
          )}
        </section>

        {/* Capability honesty table */}
        <section className="tuning-section">
          <h3>What the desktop backend can change</h3>
          <p className="tuning-note">
            The native build is significantly more capable than the in-browser engine, but not every capability is
            wired through the UI yet. This table tracks what's live versus what's coming.
          </p>
          <div className="caps">
            {DESKTOP_CAPS.map((c) => (
              <div key={c.label} className="cap-row">
                <div className="cap-head">
                  <span className="cap-label">{c.label}</span>
                  <span className={`cap-badge cap-${c.supported}`}>
                    {c.supported === "yes" ? "Live" : c.supported === "future" ? "Planned" : "Out of scope"}
                  </span>
                </div>
                <p className="cap-note">{c.note}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="tuning-footer">
          <button className="tuning-ghost" onClick={resetToDefaults}>Reset to defaults</button>
          <button className="tuning-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className={mono ? "info-val mono" : "info-val"}>{value}</span>
    </div>
  );
}

function NumberInput({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
