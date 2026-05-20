import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

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

// Sidebar specific APIs
const sidebarAPI = {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) =>
    electronAPI.ipcRenderer.invoke("sidebar-chat-message", request),

  clearChat: () => electronAPI.ipcRenderer.invoke("sidebar-clear-chat"),

  getMessages: () => electronAPI.ipcRenderer.invoke("sidebar-get-messages"),

  onChatResponse: (callback: (data: ChatResponse) => void) => {
    electronAPI.ipcRenderer.on("chat-response", (_, data) => callback(data));
  },

  onMessagesUpdated: (callback: (messages: any[]) => void) => {
    electronAPI.ipcRenderer.on("chat-messages-updated", (_, messages) =>
      callback(messages)
    );
  },

  removeChatResponseListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-response");
  },

  removeMessagesUpdatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => electronAPI.ipcRenderer.invoke("get-page-content"),
  getPageText: () => electronAPI.ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => electronAPI.ipcRenderer.invoke("get-current-url"),

  // Tab information
  getActiveTabInfo: () => electronAPI.ipcRenderer.invoke("get-active-tab-info"),

  // Auth functionality
  startCopilotLogin: () =>
    electronAPI.ipcRenderer.invoke("copilot-start-login"),

  pollCopilotToken: (deviceCode: string, interval: number, expiresIn: number) =>
    electronAPI.ipcRenderer.invoke("copilot-poll-token", deviceCode, interval, expiresIn),

  getCopilotAuthStatus: () =>
    electronAPI.ipcRenderer.invoke("copilot-auth-status"),

  copilotLogout: () =>
    electronAPI.ipcRenderer.invoke("copilot-logout"),

  onAuthRequired: (callback: () => void) => {
    electronAPI.ipcRenderer.on("auth-required", () => callback());
  },

  onAuthComplete: (callback: () => void) => {
    electronAPI.ipcRenderer.on("auth-complete", () => callback());
  },

  removeAuthListeners: () => {
    electronAPI.ipcRenderer.removeAllListeners("auth-required");
    electronAPI.ipcRenderer.removeAllListeners("auth-complete");
  },

  // Agent step events (real-time tool activity)
  onAgentStep: (callback: (step: any) => void) => {
    electronAPI.ipcRenderer.on("agent-step", (_, step) => callback(step));
  },

  removeAgentListeners: () => {
    electronAPI.ipcRenderer.removeAllListeners("agent-step");
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
