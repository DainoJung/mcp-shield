<p align="center">
  <img src="https://img.shields.io/npm/v/@daino/mcp-shield?style=flat-square&color=cb3837" alt="npm version" />
  <img src="https://img.shields.io/npm/dm/@daino/mcp-shield?style=flat-square&color=blue" alt="downloads" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" alt="node version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license" />
</p>

<h1 align="center">mcp-shield</h1>

<p align="center">
  <strong>The nginx of MCP — drop-in resilience middleware for any MCP server.</strong>
</p>

<p align="center">
  Timeout · Retry · Circuit Breaker · Structured Logging
</p>

---

## Why

MCP servers have **zero built-in resilience**. A hung GitHub API blocks your agent for 600 seconds. A transient network blip crashes the entire chain. A dead server keeps getting hammered with requests.

**mcp-shield** is a transparent stdio proxy that sits between your agent and MCP server. One command, zero code changes.

```
Agent ←stdio→ mcp-shield ←stdio→ MCP Server
```

## Install

```bash
npm install -g @daino/mcp-shield
```

Or run directly with `npx`:

```bash
npx @daino/mcp-shield wrap -- npx @modelcontextprotocol/server-github
```

## Quick Start

```bash
# Wrap any MCP server with sensible defaults (30s timeout, 2 retries)
mcp-shield wrap -- npx @modelcontextprotocol/server-github

# Custom timeout and retries
mcp-shield wrap --timeout 60s --retries 5 -- npx server-github

# Using a config file
mcp-shield wrap --config mcp-shield.yaml --server github
```

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "@daino/mcp-shield", "wrap",
        "--timeout", "30s", "--retries", "3",
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

Done. Your GitHub MCP server now has timeout, retry, and circuit breaker protection.

## Features

### Timeout

Kill hung tool calls. No more 600-second waits.

```yaml
timeout: 30s  # per-tool override available
```

### Retry

Exponential backoff + jitter. Deterministic errors (invalid params, method not found) are never retried.

```yaml
retries:
  max: 3
  backoff: exponential  # 1s → 2s → 4s
  jitter: true
```

### Circuit Breaker

After repeated failures, fail fast instead of burning tokens on a dead server.

```yaml
circuit_breaker:
  threshold: 5      # open after 5 consecutive failures
  reset_after: 60s  # try again after 60 seconds
```

States: **Closed** (normal) → **Open** (rejecting) → **Half-Open** (testing)

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

## Config File

For multi-server setups:

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
      max: 1
```

## Programmatic Usage

```typescript
import { shield } from '@daino/mcp-shield';

const proxy = shield({
  command: 'npx',
  args: ['@modelcontextprotocol/server-github'],
  timeout: 30_000,
  retries: { max: 3, backoff: 'exponential', jitter: true },
  circuitBreaker: { threshold: 5, resetAfter: 60_000 },
});

proxy.start();
```

## Comparison

| | mcp-shield | No protection | General retry libs |
|---|:---:|:---:|:---:|
| MCP-native (JSON-RPC aware) | ✅ | — | ❌ |
| Per-tool config | ✅ | — | ❌ |
| Zero agent code changes | ✅ | — | ❌ |
| Circuit breaker | ✅ | ❌ | ✅ |
| Structured MCP logging | ✅ | ❌ | ❌ |
| Drop-in Claude Desktop support | ✅ | — | ❌ |

## Roadmap

- [x] Timeout + Retry + Circuit Breaker + Logging
- [x] Response Validation (schema check)
- [x] Tool Filtering (expose only specific tools)
- [x] Rate Limiting (per-tool call caps)
- [x] Metrics Export (Prometheus-compatible)
- [x] Multi-server Composition
- [ ] Hot-reload config
- [ ] Dashboard UI

## Contributing

Contributions welcome! Please [open an issue](https://github.com/DainoJung/mcp-shield/issues) first to discuss what you'd like to change.

```bash
git clone https://github.com/DainoJung/mcp-shield.git
cd mcp-shield
npm install
npm test
```

## License

[MIT](LICENSE)
