<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- All app data (sessions, keys, projects, history) lives in localStorage via `src/lib/neola-store.ts` — the app is local-first, no backend.
- AI calls go directly from the browser to the user's chosen provider with their own key (`src/lib/neola-ai.ts`, OpenAI-compatible `/chat/completions`) — users bring their own tokens.
- Each session has its own route `/s/$sessionId`; `/` redirects to the latest session.
