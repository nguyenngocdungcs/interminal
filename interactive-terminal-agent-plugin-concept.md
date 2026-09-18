# Product Concept Specification: Interactive Terminal Plugin for AI Agents

## 1. Overview & Vision
This product is an interactive terminal companion plugin designed for AI agent platforms (such as Claude Desktop, Hermes Agent, and other Model Context Protocol / tool-calling frameworks).

The plugin bridges autonomous AI reasoning with real-world infrastructure execution. It maintains an active, persistent remote SSH session while providing a human-in-the-loop (HITL) graphical web interface where the user can monitor operations in real time, approve or reject commands before they run, edit proposed commands, or manually take over the keyboard.

---

## 2. The Core Problem It Solves
Current AI terminal plugins suffer from significant limitations:
* **Stateless execution:** Conventional agent tools execute commands as isolated `ssh host "cmd"` calls. Every command loses session context, environment variables, working directories, and cannot support long-running tasks or interactive programs.
* **Lack of visual transparency:** The human user only sees output after the command has completely finished (or failed), making it impossible to observe real-time progress or stuck operations.
* **Rigid safety controls:** Tool approvals are typically coarse-grained (approve once or block completely) without the ability to inspect the live terminal state, tweak command arguments before execution, or intervene manually.

---

## 3. High-Level Concept & Persona Workflow

### Actors
* **User (Operator):** Observes the execution via a local browser UI, reviews high-risk command proposals, inspects terminal logs, and steps in manually when necessary.
* **AI Agent (e.g., Hermes, Claude):** Submits commands to inspect systems, build applications, edit configurations, and resolve issues.
* **Interactive Terminal Plugin (The Product):** Mediates between the AI agent, the web UI, and the remote host.

### Typical Interaction Flow
1. **Initiation:** The user asks the AI agent to accomplish a remote task (e.g., *"Deploy the latest commit and check service health on production"*).
2. **AI Action Proposal:** The AI agent issues a tool invocation to run a command.
3. **Approval Gate:**
   - The plugin pauses the agent's request.
   - The proposed command appears prominently in the Web UI.
   - The human operator reviews the command and selects:
     - **Approve:** The command executes immediately.
     - **Edit & Approve:** The user modifies flags, paths, or syntax, then submits.
     - **Reject:** The execution is aborted, and a cancellation notice or explanatory message is returned to the AI.
4. **Live Execution & Streaming:**
   - Once approved, the command executes in the active SSH session.
   - The command and its live output stream character-by-character into the web terminal viewer.
5. **Completion Resolution:**
   - The plugin detects when the command finishes execution and captures the terminal output and exit status.
   - Output and status are returned to the AI agent so it can reason about the result and decide on next steps.
6. **Manual Intervention (Optional):**
   - At any point, the user can focus the web terminal and type directly into the remote shell (e.g., answering prompts, hitting `Ctrl+C`, or inspecting files).

---

## 4. Key Functional Capabilities

### A. Persistent Remote Session Management
* **Stateful Shell:** Maintains a persistent remote shell (pseudo-terminal) throughout the entire AI conversation.
* **Context Preservation:** Changes to directories (`cd`), exported variables (`export KEY=VAL`), virtual environments, or session multiplexers (`tmux`/`screen`) persist across consecutive commands.
* **Interactive Prompt Support:** Supports two-way communication when commands require inputs (e.g., confirmations, package installation prompts, pagers).

### B. Human-in-the-Loop (HITL) Command Gate
* **Intercept & Review:** All or selected mutating commands are intercepted before execution.
* **Action Controls:**
  * **Approve:** Run the proposed command unmodified.
  * **Modify / Edit:** Alter command parameters before sending to shell.
  * **Reject with Feedback:** Provide a reason back to the AI (e.g., *"Do not delete this folder, use /tmp instead"*).
* **Configurable Auto-Approval (Whitelist):** Optional rules to automatically permit safe read-only commands (e.g., `ls`, `pwd`, `cat`, `git status`) to speed up agent workflows while gating risky operations (`rm`, `sudo`, `systemctl`, `dd`).

### C. Live Web Terminal Interface
* **Real-time Streaming:** Renders live terminal output with full ANSI color, text formatting, and cursor management.
* **Dual Input Mode:**
  * Displays AI-initiated actions with visual indicators.
  * Accepts direct human keyboard inputs for instant manual takeover.
* **Command History & Status:** Visual log of past commands, their approval status, execution duration, and exit codes.

### D. Completion & State Detection
* **Accurate Completion Tracking:** Detects command completion and exit status dynamically, avoiding blind periodic polling or arbitrary delays.
* **Hang & Timeout Protection:** Handles unresponsive commands gracefully, providing mechanisms to signal termination (`Ctrl+C` / `SIGINT`) and report timeout conditions back to the AI agent.

---

## 5. Non-Functional Requirements & Design Principles

* **Protocol Agnostic Interface:** Designed to fit standard AI tool-calling and agent protocol patterns (such as the Model Context Protocol - MCP) so it easily connects to Claude Desktop, Hermes Agent, or custom LLM frameworks.
* **Zero Host Pollution:** Operates against standard remote servers via standard SSH without requiring proprietary agents or daemons installed on the remote machine.
* **Low Latency:** Keystroke streaming and output relay must feel like a native local terminal experience.
* **Safe by Default:** Execution pauses on unconfirmed commands whenever safety settings or risk levels demand confirmation.
