// src/main/copilot/auth.ts

import { app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import {
  GITHUB_CLIENT_ID,
  GITHUB_SCOPES,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_OAUTH_TOKEN_URL,
  COPILOT_TOKEN_URL,
  githubHeaders,
} from "./constants";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

interface CopilotTokenResponse {
  token: string;
  expires_at: number;
}

// Simple JSON file store for token persistence
function getStorePath(): string {
  const dir = join(app.getPath("userData"), "auth");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "copilot.json");
}

function readStore(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(getStorePath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(data: Record<string, any>): void {
  writeFileSync(getStorePath(), JSON.stringify(data), "utf-8");
}

export class CopilotAuth {
  private accessToken: string | null = null;
  private copilotToken: string | null = null;
  private copilotTokenExpiresAt: number = 0;

  constructor() {
    const store = readStore();
    this.accessToken = store.githubAccessToken || null;
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /**
   * Step 1 of device flow: request a device code from GitHub.
   */
  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const resp = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: GITHUB_SCOPES,
      }),
    });

    if (!resp.ok) {
      throw new Error(`Device code request failed: ${resp.status}`);
    }

    return resp.json() as Promise<DeviceCodeResponse>;
  }

  /**
   * Step 2 of device flow: poll GitHub until user authorizes.
   */
  async pollForAccessToken(
    deviceCode: string,
    interval: number,
    expiresIn: number,
    signal?: AbortSignal
  ): Promise<string> {
    const deadline = Date.now() + expiresIn * 1000;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new Error("Auth cancelled by user");
      }

      await new Promise((resolve) => setTimeout(resolve, interval * 1000));

      const resp = await fetch(GITHUB_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const data = await resp.json();

      if (data.access_token) {
        this.accessToken = data.access_token;
        writeStore({ githubAccessToken: data.access_token });
        return data.access_token;
      }

      if (data.error === "expired_token") {
        throw new Error("Device code expired. Please try again.");
      }

      if (data.error === "access_denied") {
        throw new Error("Access denied by user.");
      }

      if (data.error === "slow_down") {
        interval += 5;
      }
    }

    throw new Error("Device flow timed out.");
  }

  /**
   * Exchange the GitHub access token for a short-lived Copilot session token.
   */
  async ensureCopilotToken(): Promise<string> {
    if (!this.accessToken) {
      throw new Error("Not authenticated. Run device flow first.");
    }

    const now = Math.floor(Date.now() / 1000);
    if (this.copilotToken && this.copilotTokenExpiresAt > now + 300) {
      return this.copilotToken;
    }

    const resp = await fetch(COPILOT_TOKEN_URL, {
      method: "GET",
      headers: {
        ...githubHeaders(),
        authorization: `token ${this.accessToken}`,
      },
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        this.logout();
        throw new Error("GitHub token expired. Please sign in again.");
      }
      throw new Error(`Copilot token exchange failed: ${resp.status}`);
    }

    const data = (await resp.json()) as CopilotTokenResponse;
    this.copilotToken = data.token;
    this.copilotTokenExpiresAt = data.expires_at;
    return data.token;
  }

  /**
   * Clear all tokens and log out.
   */
  logout(): void {
    this.accessToken = null;
    this.copilotToken = null;
    this.copilotTokenExpiresAt = 0;
    writeStore({});
  }
}
