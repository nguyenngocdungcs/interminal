import { EventEmitter } from 'events';
import { PtyManager } from './pty-manager.js';

export interface TabInfo {
  id: number;
  title: string;
}

export interface TabSession extends TabInfo {
  ptyManager: PtyManager;
}

export class TabManager extends EventEmitter {
  private tabs: Map<number, TabSession> = new Map();
  private nextId = 0;
  private activeTabId = 0;

  constructor() {
    super();
    // Initialize with default tab 0
    this.createTab('Terminal 1');
  }

  public getTabs(): TabInfo[] {
    return Array.from(this.tabs.values()).map((tab) => ({
      id: tab.id,
      title: tab.title,
    }));
  }

  public getTab(tabId: number): TabSession | undefined {
    return this.tabs.get(tabId);
  }

  public setActiveTabId(tabId: number): void {
    if (this.tabs.has(tabId)) {
      this.activeTabId = tabId;
    }
  }

  public createTab(title?: string): TabSession {
    const id = this.nextId++;
    const tabTitle = title && title.trim() ? title.trim() : `Terminal ${id + 1}`;
    const ptyManager = new PtyManager();
    ptyManager.spawnSession();

    const session: TabSession = {
      id,
      title: tabTitle,
      ptyManager,
    };

    ptyManager.on('data', (data: string) => {
      this.emit('data', id, data);
    });

    ptyManager.on('exit', (info: { exitCode: number; signal?: number }) => {
      this.emit('exit', id, info);
    });

    this.tabs.set(id, session);
    this.activeTabId = id;

    const tabInfo: TabInfo = { id, title: tabTitle };
    this.emit('tab_created', tabInfo);
    return session;
  }

  public closeTab(tabId: number): boolean {
    const session = this.tabs.get(tabId);
    if (!session) {
      return false;
    }

    const tabList = Array.from(this.tabs.values());
    const closedIndex = tabList.findIndex((t) => t.id === tabId);

    session.ptyManager.destroy();
    this.tabs.delete(tabId);
    this.emit('tab_closed', tabId);

    if (this.tabs.size === 0) {
      this.nextId = 0;
      this.createTab('Terminal 1');
    } else if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.values());
      const nearestIndex = closedIndex > 0 ? closedIndex - 1 : 0;
      this.activeTabId = remainingTabs[nearestIndex].id;
    }

    return true;
  }

  public renameTab(tabId: number, title: string): TabInfo {
    const session = this.tabs.get(tabId);
    if (!session) {
      throw new Error(`Tab not found: ${tabId}`);
    }

    session.title = title.trim();
    const tabInfo: TabInfo = { id: session.id, title: session.title };
    this.emit('tab_renamed', tabInfo);
    return tabInfo;
  }

  public destroyAll(): void {
    for (const session of this.tabs.values()) {
      session.ptyManager.destroy();
    }
    this.tabs.clear();
  }
}
