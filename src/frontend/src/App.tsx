import React, { useState, useRef } from 'react';
import { TerminalView } from './components/TerminalView';
import { TabBar, TabItem } from './components/TabBar';

export const App: React.FC = () => {
  const [tabs, setTabs] = useState<TabItem[]>([{ id: 0, title: 'Terminal 1' }]);
  const [activeTabId, setActiveTabId] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  const handleSelectTab = (id: number) => {
    setActiveTabId(id);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'tab_switch', tabId: id }));
    }
  };

  const handleCreateTab = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'tab_create' }));
    }
  };

  const handleCloseTab = (id: number) => {
    if (id === activeTabId && tabs.length > 1) {
      const index = tabs.findIndex((t) => t.id === id);
      const nearestTab = index > 0 ? tabs[index - 1] : tabs[index + 1];
      if (nearestTab) {
        setActiveTabId(nearestTab.id);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'tab_switch', tabId: nearestTab.id }));
        }
      }
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'tab_close', tabId: id }));
    }
  };

  const handleRenameTab = (id: number, newTitle: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'tab_rename', tabId: id, title: newTitle }));
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Top Tab Bar Header */}
      <header className="h-9 bg-slate-950 border-b border-slate-800/80 flex items-end select-none shrink-0 w-full overflow-hidden">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCreateTab={handleCreateTab}
          onCloseTab={handleCloseTab}
          onRenameTab={handleRenameTab}
        />
      </header>

      {/* Main Terminal View Container */}
      <main className="flex-1 w-full relative overflow-hidden bg-[#0b0f19]">
        <TerminalView
          tabs={tabs}
          activeTabId={activeTabId}
          onTabsUpdate={setTabs}
          onActiveTabUpdate={setActiveTabId}
          wsRef={wsRef}
        />
      </main>
    </div>
  );
};

export default App;
