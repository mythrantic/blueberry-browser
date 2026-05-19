// src/main/copilot/provider.ts

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { COPILOT_CHAT_BASE_URL, copilotRequestHeaders } from "./constants";
import type { CopilotAuth } from "./auth";

/**
 * Creates a Vercel AI SDK-compatible language model backed by GitHub Copilot.
 */
export function createCopilotModel(
  auth: CopilotAuth,
  modelName: string = "gpt-4o"
): LanguageModel {
  const provider = createOpenAI({
    baseURL: COPILOT_CHAT_BASE_URL,
    apiKey: "copilot-no-key-needed",
    compatibility: "compatible", // Force /chat/completions instead of /responses
    fetch: async (url, options) => {
      const sessionToken = await auth.ensureCopilotToken();

      const headers = {
        ...(options?.headers as Record<string, string>),
        ...copilotRequestHeaders(sessionToken),
      };

      const response = await globalThis.fetch(url, {
        ...options,
        headers,
      });

      // Patch response: Copilot omits "object" field that OpenAI SDK expects
      if (url.toString().includes("/chat/completions")) {
        const body = await response.text();
        try {
          const data = JSON.parse(body);
          let patched = false;

          if (!data.object && data.choices) {
            data.object = "chat.completion";
            patched = true;
          }

          if (Array.isArray(data.choices)) {
            for (let i = 0; i < data.choices.length; i++) {
              if (data.choices[i].index == null) {
                data.choices[i].index = i;
                patched = true;
              }
            }
          }

          if (patched) {
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }

          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        } catch {
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      }

      return response;
    },
  });

  return provider(modelName);
}
