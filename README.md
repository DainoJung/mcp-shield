# 🛡️ mcp-shield

> Production-grade resilience middleware for MCP servers. Timeout, retry, circuit breaker — in one command.

[![npm version](https://img.shields.io/npm/v/mcp-shield)](https://www.npmjs.com/package/mcp-shield)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Your MCP servers are running naked in production. mcp-shield wraps any MCP server with resilience middleware — so a slow GitHub API or a flaky database tool doesn't crash your entire agent chain.

## The Problem

MCP servers have **zero built-in resilience**:

- ⏰ **No timeout** — agent waits 600 seconds for a hung tool call
- 🔄 **No retry** — transient network errors crash the chain
- 💥 **No circuit breaker** — a dead server keeps getting hammered
- 📊 **No logging** — "something failed somewhere" is your only signal

## The Solution

mcp-shield is a transparent stdio proxy. It sits between your agent and MCP server, adding production-grade middleware with zero code changes:

```
Agent ←→ mcp-shield ←→ MCP Server
            │
            ├── ⏰ Timeout (kill hung calls)
            ├── 🔄 Retry (exponential backoff)
            ├── 💥 Circuit Breaker (fail fast)
            └── 📊 Structured Logging
```

## Quick Start

```bash
# Wrap any MCP server with sensible defaults (30s timeout, 2 retries)
npx mcp-shield wrap -- npx @modelcontextprotocol/server-github

# Custom timeout and retries
npx mcp-shield wrap --timeout 60s --retries 5 -- npx server-github

# Using a config file
npx mcp-shield wrap --config mcp-shield.yaml --server github
```

## Claude Desktop Integration

Add mcp-shield to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "mcp-shield", "wrap",
        "--timeout", "30s",
        "--retries", "3",
        "--",
        "npx", "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_TOKEN": "your-token-here"
      }
    }
  }
}
```

That's it. Your GitHub MCP server now has timeout, retry, and circuit breaker protection.

## Config File

For multi-server setups, use a YAML config:

```yaml
# mcp-shield.yaml
defaults:
  timeout: 30s
  retries:
    max: 3
    backoff: exponential
    jitter: true
  circuit_breaker:
    threshold: 5
    reset_after: 60s

servers:
  github:
    command: "npx @modelcontextprotocol/server-github"
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
    tools:
      get_file_contents:
        timeout: 60s          # slow tool gets more time
      search_repositories:
        retries:
          max: 5              # flaky tool gets more retries

  filesystem:
    command: "npx @modelcontextprotocol/server-filesystem /home/user"
    timeout: 10s
    retries:
      max: 1                  # local filesystem rarely needs retry
```

## How It Works

### Timeout

Kills tool calls that exceed the configured duration. No more 600-second hangs.

```yaml
timeout: 30s   # Per-tool override available
```

When a timeout fires, the agent gets a clear error:
```
Tool 'get_file_contents' timed out after 30000ms
```

### Retry

Automatically retries failed tool calls with exponential backoff + jitter.

```yaml
retries:
  max: 3              # Up to 3 retries (4 total attempts)
  backoff: exponential  # 1s → 2s → 4s
  jitter: true         # Randomize ±50% to avoid thundering herd
```

Smart retry: deterministic errors (invalid params, method not found) are never retried.

### Circuit Breaker

After repeated failures, stop calling the dead server. Fail fast instead of burning tokens.

```yaml
circuit_breaker:
  threshold: 5       # Open after 5 consecutive failures
  reset_after: 60s   # Try again after 60 seconds
```

States: **Closed** (normal) → **Open** (rejecting) → **Half-Open** (testing one request).

### Structured Logging

Every tool call logged as structured JSON to stderr:

```json
{
  "level": "info",
  "msg": "tool_call_end",
  "server": "github",
  "tool": "get_file_contents",
  "duration_ms": 245,
  "status": "success",
  "attempt": 1
}
```

Use `--log-format pretty` for human-readable output during development.

## Programmatic Usage

```typescript
import { shield } from 'mcp-shield';

const server = shield({
  command: 'npx @modelcontextprotocol/server-github',
  timeout: 30_000,
  retries: { max: 3, backoff: 'exponential', jitter: true },
  circuitBreaker: { threshold: 5, resetAfter: 60_000 },
});

// server is a ChildProcess with mcp-shield proxy
```

## Why mcp-shield?

| Feature | mcp-shield | No protection | General retry libs |
|---------|:----------:|:-------------:|:-----------------:|
| MCP-native (understands JSON-RPC) | ✅ | — | ❌ |
| Per-tool config | ✅ | — | ❌ |
| Zero agent code changes | ✅ | — | ❌ |
| Circuit breaker | ✅ | ❌ | ✅ |
| Structured MCP logging | ✅ | ❌ | ❌ |
| Drop-in Claude Desktop support | ✅ | — | ❌ |

## Roadmap

- [x] **v0.1** — Timeout + Retry + Circuit Breaker + Logging
- [x] **v0.2** — Response Validation (schema check on tool responses)
- [x] **v0.3** — Tool Filtering (expose only specific tools)
- [x] **v0.4** — Rate Limiting (per-tool call caps)
- [x] **v0.5** — Metrics Export (Prometheus-compatible `/metrics` endpoint)
- [x] **v0.6** — Multi-server Composition

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
