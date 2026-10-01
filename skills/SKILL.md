---
name: interminal
description: Guidelines for operating the Interminal interactive terminal companion, handling long-running tasks, reading terminal output efficiently with cursor, and managing interactive prompts and sensitive commands.
---

# Interminal Guidelines

### 🛠️ Quick Tools Overview
- **`write_to_terminal`**: Send commands, interactive inputs, or control characters (e.g. `\x03` with `auto_enter: false` for `Ctrl+C`). Defaults to `auto_enter: true`.
- **`read_terminal`**: Read cleaned terminal output. Always pass `cursor` from the previous call to receive only new output.
- **`start_session`**: Start or restart the interactive terminal session (spawns a fresh shell and resets buffer).
- **`get_session_status`**: Inspect active session process ID and dimensions.

### 1. Opening the Web Companion
- When the user asks to open Interminal, open `http://localhost:3010` using the agent environment's built-in browser (e.g., the **Preview pane** in Hermes).

### 2. Reading Output (Always Use Cursor)
- **Always provide `cursor`:** Always pass the `cursor` index returned by the previous `read_terminal` call (e.g., `{"cursor": 42}`).
- **Avoid context bloat:** Reading without a cursor returns the entire terminal buffer history, which wastes context window tokens.

### 3. Handling Long-Running Tasks
- **Wait before re-reading:** For commands that take time to execute, sleep for a few seconds before calling `read_terminal` again with the latest `cursor`.
- **Silent / Background tasks:** If no new output appears, do **not** write additional commands. Wait a few seconds and re-read.
- **Still no progress:** If there are still no signs of completion, stop, notify the user to inspect the state, and await their confirmation before taking any further action.

### 4. Sensitive & Destructive Commands
- **Ask for confirmation first:** Before executing any destructive, irreversible, or high-impact commands (e.g., `rm -rf`, `sudo`, `git push --force`, `git reset --hard`, modifying system configurations, killing arbitrary processes, dropping databases), **always ask the user for explicit permission** before sending the command with `write_to_terminal`.
- **State the intent & command:** Present the exact command line and explain what it does when asking for confirmation.

### 5. Password & Unknown Prompts
- If the terminal asks for a password (e.g., `sudo`, SSH passphrase) or information you do not have, **stop immediately**.
- Notify the user so they can provide the input directly via the terminal or web companion. Do not attempt to guess or send arbitrary inputs.
