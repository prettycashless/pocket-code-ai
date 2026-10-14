// Calls the user's own provider directly from the device (OpenAI-compatible APIs).
import { PROVIDERS, type Msg, type ProviderId, getState } from "./neola-store";

const SYSTEM = `You are Neola, a concise expert coding agent running in a mobile terminal.
Prefer short answers, fenced code blocks with language tags, and step-by-step fixes.`;

export async function streamChat(opts: {
  provider: ProviderId;
  model: string;
  messages: Msg[];
  signal: AbortSignal;
  onDelta: (t: string) => void;
}) {
  const st = getState();
  const key = st.keys[opts.provider];
  if (!key) throw new Error(`No API key for ${PROVIDERS[opts.provider].label}. Run: /key ${opts.provider} <your-key>`);
  const base = st.baseUrls[opts.provider] || PROVIDERS[opts.provider].baseUrl;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (opts.provider === "openrouter") {
    headers["HTTP-Referer"] = location.origin;
    headers["X-Title"] = "Neola";
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM },
        ...opts.messages.filter((m) => !m.error && m.role !== "system").map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (delta) opts.onDelta(delta);
      } catch {
        /* partial */
      }
    }
  }
}

export async function listModels(provider: ProviderId): Promise<string[]> {
  const st = getState();
  const key = st.keys[provider];
  const base = st.baseUrls[provider] || PROVIDERS[provider].baseUrl;
  const res = await fetch(`${base}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const j = await res.json();
  return (j.data ?? []).map((m: { id: string }) => m.id);
}
