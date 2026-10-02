import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { TabItem } from './TabBar';

interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
}

interface TerminalViewProps {
  tabs: TabItem[];
  activeTabId: number;
  onTabsUpdate: (tabs: TabItem[]) => void;
  onActiveTabUpdate: (id: number) => void;
  onConnectionChange?: (connected: boolean) => void;
  wsRef: React.MutableRefObject<WebSocket | null>;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  tabs,
  activeTabId,
  onTabsUpdate,
  onActiveTabUpdate,
  onConnectionChange,
  wsRef,
}) => {
  const containerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const terminalsRef = useRef<Map<number, TerminalInstance>>(new Map());

  // Establish WebSocket connection once
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.port === '5173'
      ? `${window.location.hostname}:3010`
      : window.location.host;

    const wsUrl = `${protocol}//${host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      onConnectionChange?.(true);
    };

    ws.onclose = () => {
      onConnectionChange?.(false);
      const activeInst = terminalsRef.current.get(activeTabId);
      activeInst?.term.writeln('\r\n\x1b[31m[Interminal] Connection to backend lost. Refresh the page to reconnect.\x1b[0m');
    };

    ws.onerror = () => {
      onConnectionChange?.(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'terminal_output' && typeof msg.data === 'string') {
          const tabId = typeof msg.tabId === 'number' ? msg.tabId : 0;
          const inst = terminalsRef.current.get(tabId);
          if (inst) {
            inst.term.write(msg.data);
          }
        } else if (msg.type === 'tab_list' && Array.isArray(msg.tabs)) {
          onTabsUpdate(msg.tabs);
          if (msg.tabs.length > 0 && !msg.tabs.some((t: TabItem) => t.id === activeTabId)) {
            onActiveTabUpdate(msg.tabs[0].id);
          }
        } else if (msg.type === 'tab_created' && msg.tab) {
          onActiveTabUpdate(msg.tab.id);
        }
      } catch {
        const activeInst = terminalsRef.current.get(activeTabId);
        activeInst?.term.write(event.data);
      }
    };

    const handleResize = () => {
      const activeInst = terminalsRef.current.get(activeTabId);
      if (activeInst && ws.readyState === WebSocket.OPEN) {
        activeInst.fitAddon.fit();
        ws.send(JSON.stringify({
          type: 'terminal_resize',
          tabId: activeTabId,
          cols: activeInst.term.cols,
          rows: activeInst.term.rows,
        }));
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      for (const inst of terminalsRef.current.values()) {
        inst.term.dispose();
      }
      terminalsRef.current.clear();
    };
  }, []);

  // Initialize xterm instances for each open tab
  useEffect(() => {
    tabs.forEach((tab) => {
      const containerEl = containerRefs.current.get(tab.id);
      if (containerEl && !terminalsRef.current.has(tab.id)) {
        const term = new Terminal({
          theme: {
            background: '#0b0f19',
            foreground: '#e2e8f0',
            cursor: '#38bdf8',
            cursorAccent: '#0b0f19',
            selectionBackground: 'rgba(56, 189, 248, 0.3)',
            black: '#1e293b',
            red: '#ef4444',
            green: '#10b981',
            yellow: '#f59e0b',
            blue: '#3b82f6',
            magenta: '#a855f7',
            cyan: '#06b6d4',
            white: '#f1f5f9',
            brightBlack: '#475569',
            brightRed: '#f87171',
            brightGreen: '#34d399',
            brightYellow: '#fbbf24',
            brightBlue: '#60a5fa',
            brightMagenta: '#c084fc',
            brightCyan: '#22d3ee',
            brightWhite: '#ffffff',
          },
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          fontSize: 13,
          lineHeight: 1.25,
          cursorBlink: true,
          cursorStyle: 'block',
          allowProposedApi: true,
          scrollback: 10000,
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);

        term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          if (
            event.type === 'keydown' &&
            (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
            (event.key === 'k' || event.key === 'K')
          ) {
            event.preventDefault();
            term.clear();
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'terminal_input', tabId: tab.id, data: '\x0c' }));
            }
            return false;
          }
          return true;
        });

        term.open(containerEl);
        fitAddon.fit();

        term.onData((data) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'terminal_input', tabId: tab.id, data }));
          }
        });

        terminalsRef.current.set(tab.id, { term, fitAddon });

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && term.cols && term.rows) {
          wsRef.current.send(JSON.stringify({
            type: 'terminal_resize',
            tabId: tab.id,
            cols: term.cols,
            rows: term.rows,
          }));
        }
      }
    });

    // Clean up closed tabs
    const activeTabIds = new Set(tabs.map((t) => t.id));
    for (const [id, inst] of terminalsRef.current.entries()) {
      if (!activeTabIds.has(id)) {
        inst.term.dispose();
        terminalsRef.current.delete(id);
      }
    }
  }, [tabs]);

  // Handle active tab switching & resize adjustment
  useEffect(() => {
    const activeInst = terminalsRef.current.get(activeTabId);
    if (activeInst) {
      setTimeout(() => {
        activeInst.fitAddon.fit();
        activeInst.term.focus();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'terminal_resize',
            tabId: activeTabId,
            cols: activeInst.term.cols,
            rows: activeInst.term.rows,
          }));
        }
      }, 50);
    }
  }, [activeTabId]);

  return (
    <div className="w-full h-full bg-[#0b0f19] relative overflow-hidden">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          ref={(el) => {
            if (el) {
              containerRefs.current.set(tab.id, el);
            } else {
              containerRefs.current.delete(tab.id);
            }
          }}
          className={`w-full h-full ${tab.id === activeTabId ? 'block' : 'hidden'}`}
          onClick={() => {
            const inst = terminalsRef.current.get(tab.id);
            inst?.term.focus();
          }}
        />
      ))}
    </div>
  );
};
