import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Terminal } from 'lucide-react';

export interface TabItem {
  id: number;
  title: string;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: number;
  onSelectTab: (id: number) => void;
  onCreateTab: () => void;
  onCloseTab: (id: number) => void;
  onRenameTab: (id: number, newTitle: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  onRenameTab,
}) => {
  const [editingTabId, setEditingTabId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  const handleDoubleClick = (tab: TabItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabId(tab.id);
    setEditTitle(tab.title);
  };

  const handleRenameSubmit = (id: number) => {
    if (editTitle.trim()) {
      onRenameTab(id, editTitle.trim());
    }
    setEditingTabId(null);
  };

  const handleKeyDown = (id: number, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit(id);
    } else if (e.key === 'Escape') {
      setEditingTabId(null);
    }
  };

  const tabContainerRef = useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    if (tabContainerRef.current) {
      if (e.deltaY !== 0) {
        tabContainerRef.current.scrollLeft += e.deltaY;
      }
    }
  };

  useEffect(() => {
    if (tabContainerRef.current) {
      tabContainerRef.current.scrollLeft = tabContainerRef.current.scrollWidth;
    }
  }, [tabs.length]);

  return (
    <div className="flex items-center h-full w-full select-none overflow-hidden bg-slate-950">
      {/* Scrollable Tabs Region */}
      <div
        ref={tabContainerRef}
        onWheel={handleWheel}
        className="flex-1 flex items-center h-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex items-center h-full shrink-0">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isEditing = editingTabId === tab.id;

            return (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                onDoubleClick={(e) => handleDoubleClick(tab, e)}
                className={`group relative flex items-center h-full px-3.5 text-xs font-medium cursor-pointer transition-colors border-r border-slate-800/80 select-none shrink-0 ${
                  isActive
                    ? 'bg-[#0b0f19] text-slate-100 font-semibold z-10'
                    : 'bg-slate-900/50 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                {/* Top active tab accent line */}
                {isActive && (
                  <div className="absolute top-0 left-0 right-0 h-[2px] bg-sky-400" />
                )}

                <Terminal
                  size={13}
                  className={`mr-2 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-400'}`}
                />

                {isEditing ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleRenameSubmit(tab.id)}
                    onKeyDown={(e) => handleKeyDown(tab.id, e)}
                    className="bg-slate-950 text-slate-100 px-1 py-0.5 rounded outline-none border border-sky-500 text-xs w-24"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate max-w-[140px] tracking-wide">{tab.title}</span>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`ml-2.5 p-0.5 rounded hover:bg-slate-800 transition-colors ${
                    isActive
                      ? 'text-slate-400 hover:text-slate-100'
                      : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-200'
                  }`}
                  title="Close Tab"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fixed/Sticky Add Tab Button on the Right */}
      <button
        onClick={onCreateTab}
        className="flex items-center justify-center h-full px-3 text-slate-400 hover:bg-slate-900 hover:text-slate-100 transition-colors shrink-0 border-l border-slate-800/80 bg-slate-950 z-20"
        title="New Tab"
      >
        <Plus size={15} />
      </button>
    </div>
  );
};
