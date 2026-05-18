export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

export const ollamaService = {
  async checkOllamaStatus(baseUrl: string): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async listOllamaModels(baseUrl: string): Promise<OllamaModel[]> {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`);
      if (!res.ok) throw new Error("Failed to fetch models");
      const data = await res.json();
      return data.models || [];
    } catch {
      return [];
    }
  },

  async streamChatCompletion(
    baseUrl: string,
    model: string,
    messages: { role: string; content: string }[],
    onToken: (token: string) => void,
    onDone: (stats: any) => void,
    onError: (err: Error) => void,
    controller: AbortController
  ) {
    try {
      const startTime = Date.now();
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: true
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        throw new Error(`Failed to generate: ${res.statusText}`);
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let totalTokens = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              totalTokens++;
              onToken(data.message.content);
            }
            if (data.done) {
              const endTime = Date.now();
              const durationMs = endTime - startTime;
              onDone({
                tokensPerSec: (totalTokens / durationMs) * 1000,
                totalTimeMs: durationMs,
                modelUsed: model,
                runtimeUsed: 'ollama'
              });
            }
          } catch (e) {
            // Ignore parse errors on partial chunks
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Handle abort gracefully
      } else {
        onError(err);
      }
    }
  }
};
