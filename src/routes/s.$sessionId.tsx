import { createFileRoute } from "@tanstack/react-router";
import { Terminal } from "@/components/neola/Terminal";

export const Route = createFileRoute("/s/$sessionId")({
  head: () => ({
    meta: [
      { title: "Session — Neola" },
      { name: "description", content: "A Neola coding session." },
      { property: "og:title", content: "Session — Neola" },
      { property: "og:description", content: "A Neola coding session." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  return <Terminal key={sessionId} sessionId={sessionId} />;
}
