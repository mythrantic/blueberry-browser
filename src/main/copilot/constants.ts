// src/main/copilot/constants.ts

/** VS Code Copilot Chat OAuth App Client ID */
export const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";

export const GITHUB_SCOPES = "read:user";

export const COPILOT_CHAT_BASE_URL = "https://api.githubcopilot.com";
export const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";

export const VSCODE_VERSION = "1.105.1";
export const COPILOT_VERSION = "0.32.3";
export const API_VERSION = "2025-04-01";

export function githubHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "editor-version": `vscode/${VSCODE_VERSION}`,
    "editor-plugin-version": `copilot-chat/${COPILOT_VERSION}`,
    "user-agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
    "x-github-api-version": API_VERSION,
  };
}

export function copilotRequestHeaders(sessionToken: string): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${sessionToken}`,
    "copilot-integration-id": "vscode-chat",
    "editor-version": `vscode/${VSCODE_VERSION}`,
    "editor-plugin-version": `copilot-chat/${COPILOT_VERSION}`,
    "user-agent": `GitHubCopilotChat/${COPILOT_VERSION}`,
    "openai-intent": "conversation-panel",
    "x-github-api-version": API_VERSION,
    "x-request-id": crypto.randomUUID(),
  };
}
