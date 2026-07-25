/**
 * Minimal stand-in for the Ponder GraphQL API.
 *
 * Its job is to prove the app's indexer client against a real HTTP server:
 * that it posts a valid query, parses Ponder's `{ items, totalCount }` shape,
 * and surfaces failures instead of rendering an empty table. Ponder itself is
 * not under test here.
 *
 * POST /graphql        → draw list
 * POST /graphql?fail=1 → GraphQL-level error, for the error-state test
 * POST /graphql?http=1 → HTTP 500, for the transport-failure test
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_INDEXER_PORT ?? 4510);

const DRAWS = [
  { id: "31", buyer: "0xIndexed0000000000000000000000000000aa01", price: "140500000000000000000", state: "Settled",  selectedId: "2", choice: 1, requestedAt: "1784930000", resolvedAt: "1784930039" },
  { id: "30", buyer: "0xIndexed0000000000000000000000000000aa02", price: "139000000000000000000", state: "Refunded", selectedId: null, choice: null, requestedAt: "1784926400", resolvedAt: null },
  { id: "29", buyer: "0xIndexed0000000000000000000000000000aa03", price: "138200000000000000000", state: "Settled",  selectedId: "5", choice: 0, requestedAt: "1784922800", resolvedAt: "1784922862" },
];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const server = createServer((req, res) => {
  // The app is served from a different port, so a JSON POST is preflighted.
  // Without this the browser never sends the request and the page just sits
  // empty — which is exactly how this first showed up.
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, CORS).end();
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.searchParams.get("http") === "1") {
      res.writeHead(500, { "content-type": "text/plain", ...CORS }).end("boom");
      return;
    }

    const send = (payload, status = 200) => {
      res.writeHead(status, { "content-type": "application/json", ...CORS });
      res.end(JSON.stringify(payload));
    };

    if (url.searchParams.get("fail") === "1") {
      send({ errors: [{ message: "indexer is resyncing" }] });
      return;
    }

    // Assert the client actually sent a usable query — a silent empty table
    // would otherwise look like "no draws" rather than "wrong query".
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      send({ errors: [{ message: "malformed request body" }] });
      return;
    }
    if (typeof parsed?.query !== "string" || !parsed.query.includes("draws")) {
      send({ errors: [{ message: "query did not request draws" }] });
      return;
    }

    const limit = Number(parsed?.variables?.limit ?? DRAWS.length);
    send({ data: { draws: { items: DRAWS.slice(0, limit), totalCount: 87 } } });
  });
});

server.listen(PORT, () => {
  console.log(`mock indexer listening on ${PORT}`);
});
