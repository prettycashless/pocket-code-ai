import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { createSession, getState } from "@/lib/neola-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Neola — mobile coding agent" },
      { name: "description", content: "Terminal-style AI coding agent for your phone using your own API keys." },
      { property: "og:title", content: "Neola — mobile coding agent" },
      { property: "og:description", content: "Terminal-style AI coding agent for your phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    const s = getState().sessions;
    const id = s.length ? [...s].sort((a, b) => b.updatedAt - a.updatedAt)[0].id : createSession();
    navigate({ to: "/s/$sessionId", params: { sessionId: id }, replace: true });
  }, [navigate]);
  return <div className="min-h-dvh bg-background" />;
}
