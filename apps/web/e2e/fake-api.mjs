// API falsa, só para o E2E exercitar o rewrite de /api/* sem depender da API real.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_API_PORT ?? 4010);

createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && req.url === "/api/health") {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not_found" }));
}).listen(port, () => {
  console.log(`API falsa em http://localhost:${port}`);
});
