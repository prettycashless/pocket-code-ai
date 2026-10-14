// Calls the user's own provider directly from the device (OpenAI-compatible APIs).
import { PROVIDERS, type Msg, type ProviderId, getState } from "./neola-store";

const STYLES = {
  concise: "Be terse and direct. Minimal prose, mostly code.",
  friendly: "Be warm, upbeat and encouraging, like a helpful teammate. Light chat is welcome.",
  teacher: "Explain the why behind things step by step, like a patient mentor.",
  hacker: "Talk like a laid-back terminal hacker. Witty, lowercase, still precise.",
};

function systemPrompt() {
  const p = getState().persona;
  return [
    "You are Neola, a female AI coding companion living in a mobile terminal app. You can chat casually and you are an expert programmer.",
    "Use fenced code blocks with language tags for code. Keep answers readable on a small phone screen.",
    STYLES[p.style] ?? STYLES.friendly,
    p.userName && `The user's name is ${p.userName}.`,
    p.stack && `The user's preferred stack/languages: ${p.stack}.`,
    p.instructions && `Extra instructions from the user: ${p.instructions}`,
  ].filter(Boolean).join("\n");
}

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
        { role: "system", content: systemPrompt() },
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
