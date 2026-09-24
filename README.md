# Interminal ⚡

> **The Live Interactive Terminal Companion for AI Agents**

**Interminal** is a lightweight, full-duplex terminal companion built for AI Agent platforms (such as **Hermes Agent**, **Claude Desktop**, and other [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) clients).

While your AI agent is running commands on your machine or over SSH, Interminal opens a real-time terminal window in your web browser (`http://localhost:3010`) where you can:
- 📺 **Watch live streaming execution** character-by-character with full ANSI colors.
- ⌨️ **Take over the keyboard manually** at any time (e.g. typing commands, answering confirmation prompts, `<Tab>` auto-completing, or pressing `Ctrl+C`).
- 🔄 **Preserve terminal session state** (`cd`, environment variables, virtualenvs, background jobs) across all consecutive AI actions.
- ⬆️ **Use full terminal history** with the <kbd>↑</kbd> and <kbd>↓</kbd> arrow keys just like your native terminal.

---

## 🚀 Quick Setup (1 Minute)

### 1. Clone & Build
```bash
git clone https://github.com/your-username/interminal.git
cd interminal
npm install
npm run build
```

---

## 🤖 Connecting to Your AI Agent

### With Hermes Agent
Add the following to your Hermes MCP configuration (e.g. in `~/.hermes/config.json` or your project's MCP config):

```json
{
  "mcpServers": {
    "interminal": {
      "command": "node",
      "args": [
        "/absolute/path/to/interminal/dist/backend/index.js"
      ]
    }
  }
}
```

### With Claude Desktop
Add the following to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "interminal": {
      "command": "node",
      "args": [
        "/absolute/path/to/interminal/dist/backend/index.js"
      ]
    }
  }
}
```

> **✨ How it works:** When Hermes or Claude starts, it will automatically launch Interminal in the background. Simply open **[http://localhost:3010](http://localhost:3010)** in your browser to view and interact with your terminal live!

---

## 💻 Standalone Mode (No AI Agent)

You can also use Interminal as a standalone browser terminal:

```bash
npm start
```
Then visit **[http://localhost:3010](http://localhost:3010)**.

---

## 🛠️ MCP Tools Provided to AI Agents

| Tool | Description |
| :--- | :--- |
| **`write_to_terminal`** | Writes commands, interactive prompt responses, single keystrokes, or control codes (`\x03` for Ctrl+C). Defaults to auto-appending newline (`auto_enter: true`). |
| **`read_terminal`** | Reads clean plain-text terminal scrollback using cursor-based pagination (capped at 500 lines per call) with `has_more` indicators. |
| **`start_session`** | Switches or spawns a new terminal session (local POSIX shell or remote SSH shell). |
| **`get_session_status`**| Inspects the active terminal session, PID, busy state, and dimensions. |

### Running Commands & Reading Output

1. **Send command:**
   ```json
   { "input": "npm test" }
   ```
   *Note: `auto_enter` is `true` by default, executing the command immediately.*

2. **Poll output:**
   ```json
   { "cursor": 0, "limit": 500 }
   ```
   Returns:
   ```json
   {
     "text": "> interminal@0.1.0 test\n...",
     "cursor": 42,
     "has_more": false,
     "total_lines": 42,
     "session": { "pid": 12345, "isBusy": false, "sessionType": "local" }
   }
   ```
   To continue reading subsequent output, provide the returned `cursor` in the next call: `{"cursor": 42}`. The returned `cursor` matches the index of the last line in the batch so the active shell prompt and any typed commands on that line are seamlessly captured.

3. **Interactive Prompts:**
   Send answers with the same tool: `{"input": "Alice"}` (auto-appends `\n`).

4. **Canceling or Interrupting (`Ctrl+C`):**
   Send interrupt control byte: `{"input": "\x03", "auto_enter": false}`.

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph AI ["AI Agent (Claude / Hermes)"]
        Agent["AI Reasoning Core"]
    end

    subgraph Interminal ["Interminal Backend (Port 3010)"]
        MCP["MCP Stdio Server\n(Observer API)"]
        PTY["Persistent Shell Engine\n(node-pty + Rolling Buffer)"]
        WebBridge["Fastify Web & WebSocket Server"]
    end

    subgraph Browser ["Web Companion"]
        UI["Live Terminal\n(React + Tailwind + xterm.js)"]
    end

    Agent <-->|"Stdio (JSON-RPC)"| MCP
    MCP <--> PTY
    PTY <-->|"Spawn & Stream"| Shell["Local Shell or SSH"]
    PTY -->|"Live Stream Broadcast"| WebBridge
    WebBridge <-->|"WebSocket /ws"| UI
    UI -.->|"Manual Keystrokes"| WebBridge
```

---

## 👩‍💻 Development

- **Run backend with hot-reload:** `npm run dev:backend`
- **Run frontend Vite dev server:** `npm run dev:frontend`
- **Run both concurrently:** `npm run dev`
- **Run test suite:** `npm test`
- **Build production assets:** `npm run build`

---

## 📄 License
MIT
