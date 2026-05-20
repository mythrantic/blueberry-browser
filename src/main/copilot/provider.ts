// src/main/copilot/provider.ts

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { COPILOT_CHAT_BASE_URL, copilotRequestHeaders } from "./constants";
import type { CopilotAuth } from "./auth";

/**
 * Creates a Vercel AI SDK-compatible language model backed by GitHub Copilot.
 * Uses provider.chat() to hit /chat/completions (not /responses).
 */
export function createCopilotModel(
  auth: CopilotAuth,
  modelName: string = "claude-opus-4.6"
): LanguageModel {
  const provider = createOpenAI({
    baseURL: COPILOT_CHAT_BASE_URL,
    apiKey: "copilot-no-key-needed",
    // @ts-ignore - compatibility may not exist in type but forces /chat/completions
    compatibility: "compatible",
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

      // Log request/response for debugging
      const reqBody = options?.body ? JSON.parse(options.body as string) : {};
      console.log(`🌐 Copilot API: ${url}`);
      console.log(`   Model: ${reqBody.model}, Tools: ${reqBody.tools?.length || 0}, Stream: ${reqBody.stream}`);
      console.log(`   Response: ${response.status} ${response.headers.get("content-type")}`);

      // Don't consume the body for streaming (SSE) responses
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        return response;
      }

      // Patch non-streaming response: Copilot omits "object" field
      const body = await response.text();
      try {
        const data = JSON.parse(body);
        if (!data.object && data.choices) {
          data.object = "chat.completion";
        }
        if (Array.isArray(data.choices)) {
          for (let i = 0; i < data.choices.length; i++) {
            if (data.choices[i].index == null) data.choices[i].index = i;
          }
        }
        return new Response(JSON.stringify(data), {
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
    },
  });

  // Use .chat() to hit /chat/completions endpoint (not /responses)
  return provider.chat(modelName);
}
