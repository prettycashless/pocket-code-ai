import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, ChevronDown, Menu, Plus, Square, Trash2, X, KeyRound, Folder, UserRound } from "lucide-react";
import logo from "@/assets/neola-logo.png";
import {
  PROVIDERS,
  type ProviderId,
  type Msg,
  type Persona,
  createSession,
  deleteSession,
  exportData,
  getState,
  setState,
  uid,
  updateSession,
  useNeola,
} from "@/lib/neola-store";
import { listModels, streamChat } from "@/lib/neola-ai";

const COMMANDS: [string, string][] = [
  ["/help", "show commands"],
  ["/model <provider>/<model>", "switch model, e.g. /model groq/llama-3.3-70b-versatile"],
  ["/models [provider]", "list models from a provider"],
  ["/provider <id>", "switch provider (mistral, muse, groq, openrouter)"],
  ["/key <provider> <key>", "save an API key on this device"],
  ["/keys", "open key settings"],
  ["/persona", "personalize Neola"],
  ["/baseurl <provider> <url>", "override a provider endpoint"],
  ["/new", "start a new session"],
  ["/sessions", "open session list"],
  ["/rename <title>", "rename this session"],
  ["/project <name>", "attach session to a project"],
  ["/projects", "list projects"],
  ["/clear", "clear messages in this session"],
  ["/delete", "delete this session"],
  ["/export", "download your data (without keys)"],
];
const PIDS = Object.keys(PROVIDERS) as ProviderId[];

export function Terminal({ sessionId }: { sessionId: string }) {
  const st = useNeola();
  const navigate = useNavigate();
  const session = st.sessions.find((s) => s.id === sessionId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [histIdx, setHistIdx] = useState(-1);
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Missing session (e.g. deleted or bad URL) → go home after hydration
  useEffect(() => {
    if (!getState().sessions.find((s) => s.id === sessionId)) navigate({ to: "/", replace: true });
  }, [sessionId, navigate]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [session?.messages]);

  useEffect(() => {
    if (!busy) taRef.current?.focus();
  }, [busy]);

  if (!session) return <div className="min-h-dvh bg-background" />;

  const sys = (content: string, error = false) =>
    updateSession(sessionId, (s) => ({
      ...s,
      messages: [...s.messages, { id: uid(), role: "system", content, at: Date.now(), error }],
    }));

  const goNew = (project: string | null = session.project) => {
    const id = createSession(project);
    setDrawer(false);
    navigate({ to: "/s/$sessionId", params: { sessionId: id } });
  };

  async function runCommand(raw: string) {
    if (!session) return;
    const [cmd, ...rest] = raw.trim().split(/\s+/);
    const arg = rest.join(" ");
    switch (cmd) {
      case "/help":
        return sys(COMMANDS.map(([c, d]) => `\`${c}\` — ${d}`).join("\n\n"));
      case "/model": {
        if (!arg) return setModelOpen(true);
        const slash = arg.indexOf("/");
        let p = session.provider;
        let m = arg;
        if (slash > 0 && PIDS.includes(arg.slice(0, slash) as ProviderId)) {
          p = arg.slice(0, slash) as ProviderId;
          m = arg.slice(slash + 1);
        }
        updateSession(sessionId, (s) => ({ ...s, provider: p, model: m }));
        setState((x) => ({ ...x, provider: p, model: m }));
        return sys(`model → **${PROVIDERS[p].label}** · \`${m}\``);
      }
      case "/provider": {
        const p = arg as ProviderId;
        if (!PIDS.includes(p)) return sys(`unknown provider. use: ${PIDS.join(", ")}`, true);
        const m = PROVIDERS[p].defaultModel;
        updateSession(sessionId, (s) => ({ ...s, provider: p, model: m }));
        setState((x) => ({ ...x, provider: p, model: m }));
        return sys(`provider → **${PROVIDERS[p].label}** · \`${m}\``);
      }
      case "/models": {
        const p = (arg || session.provider) as ProviderId;
        if (!PIDS.includes(p)) return sys(`unknown provider`, true);
        sys(`fetching models from ${PROVIDERS[p].label}…`);
        try {
          const ids = await listModels(p);
          return sys(ids.length ? ids.slice(0, 80).map((i) => `- \`${p}/${i}\``).join("\n") : "no models returned");
        } catch (e) {
          return sys(`failed: ${(e as Error).message}`, true);
        }
      }
      case "/key": {
        const [p, k] = rest;
        if (!PIDS.includes(p as ProviderId) || !k) return sys("usage: /key <provider> <key>", true);
        setState((x) => ({ ...x, keys: { ...x.keys, [p as ProviderId]: k } }));
        return sys(`key saved for ${PROVIDERS[p as ProviderId].label} (stored on this device only)`);
      }
      case "/persona":
      case "/personalize":
        return setPersonaOpen(true);
      case "/keys":
        return setKeysOpen(true);
      case "/baseurl": {
        const [p, u] = rest;
        if (!PIDS.includes(p as ProviderId)) return sys("usage: /baseurl <provider> <url>", true);
        setState((x) => ({ ...x, baseUrls: { ...x.baseUrls, [p as ProviderId]: u || undefined } }));
        return sys(u ? `endpoint for ${p} → ${u}` : `endpoint for ${p} reset`);
      }
      case "/new":
        return goNew();
      case "/sessions":
        return setDrawer(true);
      case "/rename":
        if (!arg) return sys("usage: /rename <title>", true);
        updateSession(sessionId, (s) => ({ ...s, title: arg }));
        return sys(`renamed → ${arg}`);
      case "/project":
        if (!arg) return sys("usage: /project <name>", true);
        setState((x) => ({ ...x, projects: x.projects.includes(arg) ? x.projects : [...x.projects, arg] }));
        updateSession(sessionId, (s) => ({ ...s, project: arg }));
        return sys(`project → ${arg}`);
      case "/projects":
        return sys(st.projects.length ? st.projects.map((p) => `- ${p}`).join("\n") : "no projects yet. use /project <name>");
      case "/clear":
        return updateSession(sessionId, (s) => ({ ...s, messages: [] }));
      case "/delete": {
        deleteSession(sessionId);
        return navigate({ to: "/", replace: true });
      }
      case "/export": {
        const blob = new Blob([exportData()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `neola-${Date.now()}.json`;
        a.click();
        return;
      }
      default:
        return sys(`unknown command \`${cmd}\`. try /help`, true);
    }
  }

  async function submit() {
    if (!session) return;
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setHistIdx(-1);
    setState((x) => ({ ...x, history: [text, ...x.history.filter((h) => h !== text)].slice(0, 100) }));
    if (text.startsWith("/")) return runCommand(text);

    const userMsg: Msg = { id: uid(), role: "user", content: text, at: Date.now() };
    const aid = uid();
    const prior = [...session.messages, userMsg];
    updateSession(sessionId, (s) => ({
      ...s,
      title: s.messages.some((m) => m.role === "user") ? s.title : text.slice(0, 40),
      messages: [...prior, { id: aid, role: "assistant", content: "", at: Date.now() }],
    }));
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = "";
    try {
      await streamChat({
        provider: session.provider,
        model: session.model,
        messages: prior,
        signal: ac.signal,
        onDelta: (d) => {
          acc += d;
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) => (m.id === aid ? { ...m, content: acc } : m)),
          }));
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === aid ? { ...m, role: "system", error: true, content: `error: ${(e as Error).message}` } : m,
          ),
        }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const suggestions = input.startsWith("/") && !input.includes(" ")
    ? COMMANDS.filter(([c]) => c.startsWith(input.split(" ")[0] ?? "")).slice(0, 6)
    : [];
  const hasKey = !!st.keys[session.provider];
  const empty = session.messages.length === 0;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button aria-label="Sessions" onClick={() => setDrawer(true)} className="rounded-md p-2 text-muted-foreground active:bg-muted">
          <Menu className="size-5" />
        </button>
        <img src={logo} alt="Neola" width={28} height={28} className="size-7 rounded-md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{session.title}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {session.project ? `~/${session.project}` : "~"} · {PROVIDERS[session.provider].label}
          </div>
        </div>
        <button aria-label="Personalize" onClick={() => setPersonaOpen(true)} className="rounded-md p-2 text-muted-foreground active:bg-muted">
          <UserRound className="size-5" />
        </button>
        <button aria-label="API keys" onClick={() => setKeysOpen(true)} className="rounded-md p-2 text-muted-foreground active:bg-muted">
          <KeyRound className="size-5" />
        </button>
      </header>

      {/* Transcript */}
      <main className="flex-1 overflow-y-auto px-4">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 select-none">
            <div className="ghost-logo text-[22vw] leading-none font-bold">neola</div>
            <p className="text-center text-xs text-muted-foreground">
              {hasKey ? `hi${st.persona.userName ? " " + st.persona.userName : ""}! chat with me, or / for commands` : `no key for ${PROVIDERS[session.provider].label} · tap the key icon`}
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-4 text-[13px] leading-relaxed">
            {session.messages.map((m) => (
              <MessageRow key={m.id} m={m} streaming={busy && m === session.messages[session.messages.length - 1]} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </main>

      {/* Composer */}
      <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {suggestions.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-xl border border-border bg-card">
            {suggestions.map(([c, d]) => (
              <button
                key={c}
                onClick={() => {
                  setInput((c.split(" ")[0] ?? "") + (c.includes(" ") ? " " : ""));
                  taRef.current?.focus();
                }}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs active:bg-muted"
              >
                <span className="text-primary">{c}</span>
                <span className="truncate text-muted-foreground">{d}</span>
              </button>
            ))}
          </div>
        )}
        <div className="rounded-xl border border-border bg-card">
          <textarea
            ref={taRef}
            value={input}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === "ArrowUp" && !input.includes("\n")) {
                const i = Math.min(histIdx + 1, st.history.length - 1);
                if (st.history[i]) { e.preventDefault(); setHistIdx(i); setInput(st.history[i]); }
              } else if (e.key === "ArrowDown" && histIdx >= 0) {
                e.preventDefault();
                const i = histIdx - 1;
                setHistIdx(i);
                setInput(i >= 0 ? (st.history[i] ?? "") : "");
              }
            }}
            placeholder="Ask anything, / for commands…"
            className="block max-h-40 w-full resize-none bg-transparent px-3 pt-3 text-[16px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <button aria-label="New session" onClick={() => goNew()} className="rounded-md p-2 text-muted-foreground active:bg-muted">
              <Plus className="size-4" />
            </button>
            <button
              onClick={() => setModelOpen(true)}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-secondary-foreground active:bg-muted"
            >
              <span className="size-2.5 shrink-0 rounded-[2px] bg-primary" />
              <span className="max-w-[46vw] truncate">{session.model}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
            <div className="flex-1" />
            {busy ? (
              <button aria-label="Stop" onClick={() => abortRef.current?.abort()} className="flex size-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                aria-label="Send"
                onClick={submit}
                disabled={!input.trim()}
                className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:bg-secondary disabled:text-muted-foreground"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {drawer && <SessionsDrawer currentId={sessionId} onClose={() => setDrawer(false)} onNew={goNew} />}
      {personaOpen && <PersonaSheet onClose={() => setPersonaOpen(false)} />}
      {keysOpen && <KeysSheet onClose={() => setKeysOpen(false)} />}
      {modelOpen && (
        <ModelSheet
          provider={session.provider}
          model={session.model}
          onClose={() => setModelOpen(false)}
          onPick={(p, m) => {
            updateSession(sessionId, (s) => ({ ...s, provider: p, model: m }));
            setState((x) => ({ ...x, provider: p, model: m }));
            setModelOpen(false);
          }}
        />
      )}
    </div>
  );
}

function MessageRow({ m, streaming }: { m: Msg; streaming: boolean }) {
  if (m.role === "user")
    return (
      <div className="flex gap-2">
        <span className="shrink-0 text-primary">❯</span>
        <div className="whitespace-pre-wrap break-words font-semibold">{m.content}</div>
      </div>
    );
  if (m.role === "system")
    return (
      <div className={`neola-md border-l-2 pl-3 text-xs ${m.error ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
      </div>
    );
  return (
    <div className="neola-md break-words text-foreground">
      {m.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown> : null}
      {streaming && <span className="cursor-blink inline-block h-4 w-2 translate-y-0.5 bg-primary" />}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-background/70" onClick={onClose}>
      <div className="max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-md p-1.5 text-muted-foreground active:bg-muted"><X className="size-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function KeysSheet({ onClose }: { onClose: () => void }) {
  const st = useNeola();
  const [keys, setKeys] = useState<Partial<Record<ProviderId, string>>>({ ...st.keys });
  const [urls, setUrls] = useState<Partial<Record<ProviderId, string>>>({ ...st.baseUrls });
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = () => {
    const clean = (o: Partial<Record<ProviderId, string>>) =>
      Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v?.trim() || undefined]).filter(([, v]) => v));
    setState((x) => ({ ...x, keys: clean(keys), baseUrls: clean(urls) }));
    setSaved(true);
    setTimeout(onClose, 600);
  };
  return (
    <Sheet title="API keys" onClose={onClose}>
      <p className="mb-4 text-[11px] text-muted-foreground">Keys stay on this phone and are sent only to the provider you use.</p>
      <div className="space-y-4">
        {PIDS.map((p) => (
          <div key={p}>
            <label className="mb-1 flex items-center justify-between text-xs">
              <span>{PROVIDERS[p].label}</span>
              {st.keys[p] && <span className="text-primary">● saved</span>}
            </label>
            <input
              type={show ? "text" : "password"}
              autoComplete="off"
              value={keys[p] ?? ""}
              placeholder="paste key"
              onChange={(e) => setKeys((k) => ({ ...k, [p]: e.target.value }))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[16px] outline-none focus:border-primary"
            />
            <input
              value={urls[p] ?? ""}
              placeholder={PROVIDERS[p].baseUrl}
              onChange={(e) => setUrls((k) => ({ ...k, [p]: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-[12px] text-muted-foreground outline-none focus:border-primary"
            />
          </div>
        ))}
      </div>
      <label className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-primary" /> show keys
      </label>
      <button onClick={save} className="mt-4 w-full rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground">
        {saved ? "saved ✓" : "save keys"}
      </button>
    </Sheet>
  );
}

const STYLE_OPTS: [Persona["style"], string][] = [
  ["serious", "straightforward & neutral"],
  ["concise", "short & direct"],
  ["teacher", "explains why"],
  ["friendly", "warm teammate"],
];

const VERBOSITY_OPTS: [Persona["verbosity"], string][] = [
  ["short", "few sentences"],
  ["normal", "balanced"],
  ["detailed", "thorough"],
];

function PersonaSheet({ onClose }: { onClose: () => void }) {
  const st = useNeola();
  const [p, setP] = useState<Persona>({ ...st.persona });
  const field = "w-full rounded-lg border border-input bg-background px-3 py-2 text-[16px] outline-none focus:border-primary";
  return (
    <Sheet title="Personalize Neola" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs">Your name</label>
          <input value={p.userName} onChange={(e) => setP({ ...p, userName: e.target.value })} placeholder="what should she call you?" className={field} />
        </div>
        <div>
          <label className="mb-1 block text-xs">Her name</label>
          <input value={p.neolaName} onChange={(e) => setP({ ...p, neolaName: e.target.value })} placeholder="Neola" className={field} />
        </div>
        <div>
          <label className="mb-1 block text-xs">Who she is</label>
          <input value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} placeholder="e.g. senior backend engineer, security researcher" className={field} />
        </div>
        <div>
          <label className="mb-1 block text-xs">Her expertise</label>
          <input value={p.expertise} onChange={(e) => setP({ ...p, expertise: e.target.value })} placeholder="e.g. distributed systems, mobile apps, devops" className={field} />
        </div>
        <div>
          <label className="mb-1 block text-xs">Personality</label>
          <div className="grid grid-cols-2 gap-2">
            {STYLE_OPTS.map(([id, d]) => (
              <button key={id} onClick={() => setP({ ...p, style: id })} className={`rounded-lg border px-3 py-2 text-left text-xs ${p.style === id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                <div className="font-bold">{id}</div>
                <div className="text-[10px] opacity-80">{d}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs">Favorite languages / stack</label>
          <input value={p.stack} onChange={(e) => setP({ ...p, stack: e.target.value })} placeholder="e.g. TypeScript, React, Python" className={field} />
        </div>
        <div>
          <label className="mb-1 block text-xs">Custom instructions</label>
          <textarea rows={4} value={p.instructions} onChange={(e) => setP({ ...p, instructions: e.target.value })} placeholder="anything Neola should always keep in mind" className={field + " resize-none"} />
        </div>
      </div>
      <button onClick={() => { setState((x) => ({ ...x, persona: p })); onClose(); }} className="mt-4 w-full rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground">
        save
      </button>
    </Sheet>
  );
}

function ModelSheet({ provider, model, onClose, onPick }: { provider: ProviderId; model: string; onClose: () => void; onPick: (p: ProviderId, m: string) => void }) {
  const [p, setP] = useState(provider);
  const [m, setM] = useState(model);
  const [list, setList] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  return (
    <Sheet title="Model" onClose={onClose}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {PIDS.map((id) => (
          <button
            key={id}
            onClick={() => { setP(id); setM(PROVIDERS[id].defaultModel); setList(null); setErr(""); }}
            className={`rounded-lg border px-3 py-2 text-xs ${p === id ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            {PROVIDERS[id].label}
          </button>
        ))}
      </div>
      <input value={m} onChange={(e) => setM(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-[16px] outline-none focus:border-primary" />
      <div className="mt-2 flex gap-2">
        <button
          onClick={async () => { setErr(""); try { setList(await listModels(p)); } catch (e) { setErr((e as Error).message); } }}
          className="flex-1 rounded-lg border border-border py-2 text-xs text-muted-foreground active:bg-muted"
        >
          fetch models
        </button>
        <button onClick={() => m.trim() && onPick(p, m.trim())} className="flex-1 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground">use</button>
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
      {list && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border">
          {list.map((id) => (
            <button key={id} onClick={() => onPick(p, id)} className="block w-full truncate px-3 py-2 text-left text-xs active:bg-muted">{id}</button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">tip: /model {p}/{m}</p>
    </Sheet>
  );
}

function SessionsDrawer({ currentId, onClose, onNew }: { currentId: string; onClose: () => void; onNew: (p?: string | null) => void }) {
  const st = useNeola();
  const navigate = useNavigate();
  const groups = new Map<string, typeof st.sessions>();
  [...st.sessions].sort((a, b) => b.updatedAt - a.updatedAt).forEach((s) => {
    const k = s.project ?? "";
    groups.set(k, [...(groups.get(k) ?? []), s]);
  });
  return (
    <div className="fixed inset-0 z-50 flex bg-background/70" onClick={onClose}>
      <aside className="flex h-full w-[82vw] max-w-sm flex-col border-r border-sidebar-border bg-sidebar pt-[env(safe-area-inset-top)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-sidebar-border p-3">
          <img src={logo} alt="" width={24} height={24} className="size-6 rounded" />
          <span className="font-pixel text-lg">neola</span>
          <div className="flex-1" />
          <button onClick={() => onNew(null)} className="flex items-center gap-1 rounded-md bg-sidebar-accent px-2 py-1.5 text-xs">
            <Plus className="size-3.5" /> new
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {[...groups.entries()].map(([proj, list]) => (
            <div key={proj} className="mb-3">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
                <Folder className="size-3" /> {proj ? proj : "no project"}
              </div>
              {list.map((s) => (
                <div key={s.id} className={`flex items-center rounded-md ${s.id === currentId ? "bg-sidebar-accent" : ""}`}>
                  <button
                    onClick={() => { onClose(); navigate({ to: "/s/$sessionId", params: { sessionId: s.id } }); }}
                    className="min-w-0 flex-1 px-2 py-2 text-left"
                  >
                    <div className="truncate text-xs">{s.title}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{s.model} · {s.messages.length} msgs</div>
                  </button>
                  <button
                    aria-label="Delete session"
                    onClick={() => {
                      deleteSession(s.id);
                      if (s.id === currentId) { onClose(); navigate({ to: "/", replace: true }); }
                    }}
                    className="p-2 text-muted-foreground active:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="border-t border-sidebar-border p-3 text-[10px] text-muted-foreground">All data saved locally on this device.</p>
      </aside>
    </div>
  );
}
