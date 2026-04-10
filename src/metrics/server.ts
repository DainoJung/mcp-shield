import { createServer, type Server } from "node:http";
import type { MetricsCollector } from "./collector.js";

/**
 * Optional HTTP server that exposes /metrics endpoint in Prometheus format.
 * Runs on a separate port so it doesn't interfere with MCP stdio protocol.
 */
export function createMetricsServer(
  collector: MetricsCollector,
  port: number,
): Server {
  const server = createServer((req, res) => {
    if (req.url === "/metrics" && req.method === "GET") {
      const body = collector.toPrometheus();
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      });
      res.end(body);
    } else if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(port);
  return server;
}
