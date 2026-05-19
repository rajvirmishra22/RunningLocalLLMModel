import { useEffect, useMemo, useRef, useState } from "react";
import { chat, cancelChat, initModel, onToken, type ModelInfo } from "./api";
import { loadGen, saveGen, effectiveGen, DEFAULT_GEN, type DesktopGenSettings } from "./storage";
import { buildDesktopReport } from "./capability";
import {
  DESKTOP_CAPS,
  recommendDesktop,
  applyRecommendation,
  profileLabel,
  readHardware,
  type OptProfile,
  type DesktopRecommendation,
} from "./tuning";
import {
  loadCloudConfig,
  saveCloudConfig,
  hasKey,
  streamCloudChat,
  testProviderKey,
  OPENAI_MODEL_PRESETS,
  ANTHROPIC_MODEL_PRESETS,
  type CloudProvider,
  type CloudProviderConfig,
} from "./cloudProviders";

type Provider = "local" | CloudProvider;

interface Msg {
  role: "user" | "assistant";
  content: string;
  /**
   * Provider/model label captured at write time so historical turns don't
   * get relabeled when the user switches providers mid-conversation.
   */
  via?: string;
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
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>("local");
  const [cloudCfg, setCloudCfg] = useState<CloudProviderConfig>(() => loadCloudConfig());
  const cloudAbortRef = useRef<AbortController | null>(null);
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

  useEffect(() => {
    saveGen(gen);
  }, [gen]);

  // Build the OpenAI/Anthropic-shaped message history from local chat state.
  // Strip the `via` metadata — the providers only want role+content.
  const historyForCloud = (latestUser: string): Array<{ role: "user" | "assistant"; content: string }> => {
    return [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: latestUser },
    ];
  };

  const providerLabel =
    provider === "local"
      ? model?.name ?? "Local"
      : provider === "openai"
        ? `OpenAI · ${cloudCfg.openaiModel}`
        : `Anthropic · ${cloudCfg.anthropicModel}`;

  const localReady = !!model && !loadError;
  const cloudReadyFor = (p: CloudProvider) => hasKey(cloudCfg, p);
  const sendReady =
    provider === "local" ? localReady : cloudReadyFor(provider);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (provider === "local" && !localReady) return;
    if (provider !== "local" && !cloudReadyFor(provider)) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    setStreaming("");

    // Capture provider attribution now so a later switch can't relabel this turn.
    const viaAtSend = providerLabel;

    if (provider === "local") {
      try {
        const opts = effectiveGen(gen);
        const full = await chat(text, opts);
        if (full.trim()) {
          setMessages((m) => [...m, { role: "assistant", content: full, via: viaAtSend }]);
        }
      } catch (e) {
        setMessages((m) => [...m, { role: "assistant", content: `Error: ${String(e)}`, via: viaAtSend }]);
      } finally {
        setStreaming("");
        setBusy(false);
      }
      return;
    }

    // Cloud path. Stream directly from the webview via fetch — no Rust hop.
    const cloudProvider: CloudProvider = provider;
    const controller = new AbortController();
    cloudAbortRef.current = controller;
    const cloudKey = cloudProvider === "openai" ? cloudCfg.openaiKey : cloudCfg.anthropicKey;
    const cloudModel = cloudProvider === "openai" ? cloudCfg.openaiModel : cloudCfg.anthropicModel;
    let acc = "";
    const persistIfAny = (suffix = "") => {
      if (acc.trim()) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: acc, via: viaAtSend + suffix },
        ]);
      }
      setStreaming("");
      setBusy(false);
    };
    await streamCloudChat(
      cloudProvider,
      cloudModel,
      historyForCloud(text),
      cloudKey,
      {
        onToken: (tok) => {
          acc += tok;
          setStreaming(acc);
        },
        onDone: () => persistIfAny(),
        onAbort: () => persistIfAny(" (stopped)"),
        onError: (err) => {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: `Error: ${err.message}`, via: viaAtSend },
          ]);
          setStreaming("");
          setBusy(false);
        },
      },
      controller.signal,
    );
  }

  function stopAny() {
    if (provider === "local") {
      void cancelChat();
    } else {
      cloudAbortRef.current?.abort();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">LocalModel Studio</div>
        <div className="topbar-right">
          <div className="provider-switch">
            <label>Run via</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              data-testid="select-provider"
            >
              <option value="local">Local · {model?.name ?? "bundled"}</option>
              <option value="openai" disabled={!cloudReadyFor("openai")}>
                OpenAI {cloudReadyFor("openai") ? `· ${cloudCfg.openaiModel}` : "(add key)"}
              </option>
              <option value="anthropic" disabled={!cloudReadyFor("anthropic")}>
                Anthropic {cloudReadyFor("anthropic") ? `· ${cloudCfg.anthropicModel}` : "(add key)"}
              </option>
            </select>
          </div>

          <div className="status">
            {provider === "local" && loadError && <span className="err">Failed: {loadError}</span>}
            {provider === "local" && !loadError && !model && <span className="dim">Loading model…</span>}
            {provider === "local" && model && <span className="ok">{model.name} · ready</span>}
            {provider === "openai" && <span className="ok cloud">Sending to OpenAI</span>}
            {provider === "anthropic" && <span className="ok cloud">Sending to Anthropic</span>}
          </div>

          <button
            className="tune-btn"
            onClick={() => setCloudOpen(true)}
            title="Add OpenAI or Anthropic API keys (optional)"
          >
            <span className="tune-icon">☁</span>
            Cloud Keys
          </button>
          <button
            className="tune-btn"
            onClick={() => setCapabilityOpen(true)}
            title="See what your computer can comfortably run"
          >
            <span className="tune-icon">?</span>
            What can I run?
          </button>
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
            <p>
              This app runs entirely on your machine by default. Nothing is sent anywhere — unless you opt into a
              cloud provider above with your own API key.
            </p>
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
            <div className="role">
              {m.role === "assistant" ? m.via ?? providerLabel : m.role}
            </div>
            <div className="content">{m.content}</div>
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            <div className="role">{providerLabel}</div>
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
          placeholder={
            sendReady
              ? "Send a message…"
              : provider === "local"
                ? "Waiting for model…"
                : `Add an ${provider === "openai" ? "OpenAI" : "Anthropic"} API key (Cloud Keys button above).`
          }
          disabled={!sendReady || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button onClick={stopAny} className="cancel">Stop</button>
        ) : (
          <button onClick={() => void send()} disabled={!sendReady || !input.trim()}>Send</button>
        )}
      </footer>
      <div className="composer-foot">
        {provider === "local"
          ? "Local inference. Nothing leaves your device."
          : `Messages are sent to ${provider === "openai" ? "OpenAI" : "Anthropic"}. Billed to your account.`}
      </div>

      {tuningOpen && (
        <TuningPanel
          gen={gen}
          onClose={() => setTuningOpen(false)}
          onChange={setGen}
          modelName={model?.name ?? "the bundled model"}
        />
      )}

      {capabilityOpen && <CapabilityPanel onClose={() => setCapabilityOpen(false)} />}

      {cloudOpen && (
        <CloudPanel
          cfg={cloudCfg}
          onClose={() => setCloudOpen(false)}
          onChange={(next) => {
            setCloudCfg(next);
            saveCloudConfig(next);
          }}
        />
      )}
    </div>
  );
}

function CapabilityPanel({ onClose }: { onClose: () => void }) {
  const report = useMemo(() => buildDesktopReport(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fitClass =
    report.performance.memoryFit === "Safe"
      ? "fit-safe"
      : report.performance.memoryFit === "Tight"
        ? "fit-tight"
        : "fit-risky";

  return (
    <div className="tuning-backdrop" onClick={onClose}>
      <div
        className="tuning-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capability-title"
      >
        <div className="tuning-header">
          <h2 id="capability-title">What can your computer run?</h2>
          <button className="tuning-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="tuning-sub">
          {report.hardware.ramApproximate ? `≥ ${report.hardware.ramGb} GB` : `~${report.hardware.ramGb} GB`} RAM
          {report.hardware.cpuThreads !== "Unknown" ? ` · ${report.hardware.cpuThreads} threads` : ""}
          {` · ${report.hardware.platform}`}
        </p>

        <div className="tuning-section">
          <h3>Your computer can comfortably run</h3>
          {report.comfortable.length === 0 ? (
            <p className="tuning-note">No GGUF variants in the catalog fit your memory budget.</p>
          ) : (
            <ul className="cap-list">
              {report.comfortable.map((m) => (
                <li key={m.label}>
                  <span>{m.label}</span>
                  <span className="cap-size">~{m.sizeGb.toFixed(1)} GB{m.bundled ? " · bundled" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="tuning-section">
          <h3>Recommended setup</h3>
          <div className="cap-kv">
            <span>Model</span><strong>{report.recommended.modelLabel}</strong>
            <span>Context</span><strong>{report.recommended.context}</strong>
            <span>KV cache</span><strong>{report.recommended.kvCache}</strong>
            <span>FlashAttention</span><strong>{report.recommended.flashAttention}</strong>
            <span>Backend</span><strong>{report.recommended.backend}</strong>
            <span>Batch size</span><strong>{report.recommended.batchSize}</strong>
          </div>
        </div>

        <div className="tuning-section">
          <h3>Estimated performance</h3>
          <div className="cap-kv">
            <span>Memory fit</span>
            <strong><span className={`fit-chip ${fitClass}`}>{report.performance.memoryFit}</span></strong>
            <span>Quality</span><strong>{report.performance.quality}</strong>
            <span>Speed</span><strong>{report.performance.speed}</strong>
          </div>
        </div>

        {report.caveats.length > 0 && (
          <div className="cap-caveats">
            {report.caveats.map((c, i) => (
              <p key={i}>{c}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cloud Keys panel — BYO API keys for OpenAI/Anthropic. Optional, local-first
 * is still the default. Keys live in localStorage; we surface that fact in the
 * panel.
 */
function CloudPanel({
  cfg,
  onClose,
  onChange,
}: {
  cfg: CloudProviderConfig;
  onClose: () => void;
  onChange: (next: CloudProviderConfig) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="tuning-backdrop" onClick={onClose}>
      <div className="tuning-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="tuning-header">
          <h2>Cloud Keys</h2>
          <button className="tuning-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p className="tuning-sub">
          Optional. Paste your own OpenAI or Anthropic API key to chat with their cloud models from this app.
          A ChatGPT Plus / Claude Pro subscription is <strong>not</strong> the same thing — only a developer API key
          (billed per token) works. Get one at{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a>{" "}
          or{" "}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
        </p>

        <CloudProviderRow
          provider="openai"
          label="OpenAI"
          cfg={cfg}
          onChange={onChange}
          presets={OPENAI_MODEL_PRESETS}
        />
        <CloudProviderRow
          provider="anthropic"
          label="Anthropic (Claude)"
          cfg={cfg}
          onChange={onChange}
          presets={ANTHROPIC_MODEL_PRESETS}
        />

        <p className="tuning-note">
          Keys are saved in this app's localStorage. They are not synced and are not encrypted at rest. If you share
          this machine, remove the keys when you're done.
        </p>

        <div className="tuning-footer">
          <button className="tuning-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

type TestStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok" }
  | { state: "fail"; message: string };

function CloudProviderRow({
  provider,
  label,
  cfg,
  onChange,
  presets,
}: {
  provider: CloudProvider;
  label: string;
  cfg: CloudProviderConfig;
  onChange: (next: CloudProviderConfig) => void;
  presets: Array<{ id: string; label: string }>;
}) {
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<TestStatus>({ state: "idle" });
  const keyField = provider === "openai" ? "openaiKey" : "anthropicKey";
  const modelField = provider === "openai" ? "openaiModel" : "anthropicModel";
  const key = cfg[keyField];
  const model = cfg[modelField];

  const setKey = (v: string) => {
    onChange({ ...cfg, [keyField]: v });
    setStatus({ state: "idle" });
  };
  const setModel = (v: string) => onChange({ ...cfg, [modelField]: v });

  const test = async () => {
    setStatus({ state: "testing" });
    const result = await testProviderKey(provider, key, model);
    setStatus(result.ok ? { state: "ok" } : { state: "fail", message: result.error });
  };

  return (
    <section className="tuning-section">
      <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{label}</span>
        <span className={key.trim() ? "key-chip key-set" : "key-chip key-unset"}>
          {key.trim() ? "Key set" : "Not configured"}
        </span>
      </h3>
      <div className="cloud-key-row">
        <input
          type={showKey ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
          autoComplete="off"
          spellCheck={false}
          className="cloud-key-input"
        />
        <button className="tuning-ghost cloud-mini" onClick={() => setShowKey((s) => !s)}>
          {showKey ? "Hide" : "Show"}
        </button>
        <button
          className="tuning-primary cloud-mini"
          onClick={test}
          disabled={!key.trim() || status.state === "testing"}
        >
          {status.state === "testing" ? "Testing…" : "Test"}
        </button>
      </div>
      <div className="cloud-model-row">
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="model-id"
          className="cloud-model-input"
          spellCheck={false}
        />
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) setModel(e.target.value);
          }}
        >
          <option value="">Pick preset…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      {status.state === "ok" && <p className="rec-status">✓ Key works.</p>}
      {status.state === "fail" && <p className="rec-warn">⚠ {status.message}</p>}
    </section>
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
