import { ElectronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface SidebarAPI {
  // Chat functionality
  sendChatMessage: (request: ChatRequest) => Promise<void>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  removeChatResponseListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  // Tab information
  getActiveTabInfo: () => Promise<TabInfo | null>;

  // Auth
  startCopilotLogin: () => Promise<{
    success: boolean;
    userCode?: string;
    verificationUri?: string;
    deviceCode?: string;
    interval?: number;
    expiresIn?: number;
    error?: string;
  }>;
  pollCopilotToken: (deviceCode: string, interval: number, expiresIn: number) => Promise<{ success: boolean; error?: string }>;
  getCopilotAuthStatus: () => Promise<{ isAuthenticated: boolean }>;
  copilotLogout: () => Promise<{ success: boolean }>;
  onAuthRequired: (callback: () => void) => void;
  onAuthComplete: (callback: () => void) => void;
  removeAuthListeners: () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}

