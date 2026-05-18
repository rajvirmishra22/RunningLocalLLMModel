import { useEffect, useRef, useState } from "react";
import { chat, cancelChat, initModel, onToken, type ModelInfo } from "./api";

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

  async function send() {
    const text = input.trim();
    if (!text || busy || !model) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    setStreaming("");
    try {
      const full = await chat(text);
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
        <div className="status">
          {loadError && <span className="err">Failed: {loadError}</span>}
          {!loadError && !model && <span className="dim">Loading model…</span>}
          {model && <span className="ok">{model.name} · ready</span>}
        </div>
      </header>

      <main className="messages" ref={scrollRef}>
        {messages.length === 0 && !streaming && (
          <div className="empty">
            <h2>Local. Private. Yours.</h2>
            <p>This app runs entirely on your machine. Nothing is sent anywhere.</p>
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
    </div>
  );
}
