# AGENTS.md - Interminal Developer & Agent Guide

> **Context & guidelines for AI agents working on this codebase.**

---

## 1. Project Overview

**Interminal** is a persistent interactive terminal companion plugin for AI agents (Model Context Protocol / MCP clients like Claude Desktop, Hermes Agent).

### Core Concepts
- **Persistent PTY Session:** Uses `node-pty` to keep shell state (working directory, environment variables, background processes) alive across tool calls.
- **Observer-Based Model:** AI agents send input via `write_to_terminal` and inspect output via `read_terminal` with cursor-based pagination and ANSI/spinner sanitization.
- **Live Web Companion:** Streams raw terminal character I/O over WebSocket to a browser UI (running on `http://localhost:3010`), allowing humans to observe and take over input in real time.

---

## 2. Invariants & Key Gotchas

### A. Zero-Latency MCP Handshake
- The MCP server **must connect to `StdioServerTransport` immediately and synchronously** on process launch.
- Never block MCP startup on asynchronous operations (like web server listening or network calls), or MCP clients may time out during initialization.

### B. Observer Terminal Model
- `write_to_terminal`: Dispatches input to the active PTY (auto-appends `\n` by default).
- `read_terminal`: Returns paginated plain-text output with cursor tracking. Keep response payloads lean to conserve agent context tokens.
- `get_session_status` / `start_session`: For inspecting or switching terminal sessions.

### C. Unified Shell Handling
- Handles both local shells (`process.env.SHELL`) and remote SSH sessions with the same streaming and buffer lifecycle.

---

## 3. Essential Commands

- `npm test` — Run the automated test suite.
- `npm run build` — Build frontend and backend bundles for production.
- `npm run dev` — Run development mode with hot reload.
- `npm start` — Run production companion server.
