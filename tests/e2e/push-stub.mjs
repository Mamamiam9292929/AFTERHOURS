/**
 * Stellvertreter für einen Push-Dienst (P4) in der Browser-Journey: nimmt verschlüsselte Pushs entgegen,
 * wie es Google/Apple/Mozilla tun, und hebt sie auf, damit die Journey sie mit dem Geräteschlüssel
 * entschlüsseln kann. Nur Testumgebung – spricht http, weil die Edge Function diesen Host über
 * PUSH_PLAINTEXT_HOSTS ausdrücklich so anspricht.
 *
 *   POST /push/<name>      → 201 (wie ein Push-Dienst), merkt sich Kopfzeilen und Rumpf
 *   GET  /push-log/<name>  → [{ headers, body: base64 }]
 *   GET  /health
 */
import http from "node:http";

const PORT = Number(process.env.PUSH_STUB_PORT ?? 8091);
const log = new Map();

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    if (url.pathname === "/health") return void res.writeHead(200).end("ok");
    const push = /^\/push\/([\w.-]{1,80})$/.exec(url.pathname);
    if (push && req.method === "POST") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const entries = log.get(push[1]) ?? [];
        entries.push({
          headers: {
            ttl: req.headers.ttl ?? null,
            urgency: req.headers.urgency ?? null,
            "content-encoding": req.headers["content-encoding"] ?? null,
            authorization: req.headers.authorization ?? null,
          },
          body: Buffer.concat(chunks).toString("base64"),
        });
        log.set(push[1], entries);
        console.log(`push → ${push[1]} (${Buffer.concat(chunks).length} Byte)`);
        res.writeHead(201).end();
      });
      return;
    }
    const read = /^\/push-log\/([\w.-]{1,80})$/.exec(url.pathname);
    if (read && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return void res.end(JSON.stringify(log.get(read[1]) ?? []));
    }
    res.writeHead(404).end();
  })
  .listen(PORT, "0.0.0.0", () => console.log(`Push-Stellvertreter auf :${PORT}`));
