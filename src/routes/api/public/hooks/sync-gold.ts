import { createFileRoute } from "@tanstack/react-router";
import { runSync } from "@/lib/sync-gold.server";

export const Route = createFileRoute("/api/public/hooks/sync-gold")({
  server: {
    handlers: {
      POST: async () => {
        const results = await runSync();
        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "content-type": "application/json" },
        });
      },
      GET: async () => {
        const results = await runSync();
        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
