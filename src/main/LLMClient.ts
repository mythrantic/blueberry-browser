import { WebContents } from "electron";
import { streamText, type LanguageModel, type CoreMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import { CopilotAuth, createCopilotModel } from "./copilot";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

type LLMProvider = "copilot" | "openai" | "anthropic";

const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private model: LanguageModel | null = null;
  private messages: CoreMessage[] = [];
  private copilotAuth: CopilotAuth;

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.copilotAuth = new CopilotAuth();
    this.provider = this.detectProvider();
    this.modelName = this.getModelName();
    this.initializeModel();
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
  }

  get auth(): CopilotAuth {
    return this.copilotAuth;
  }

  private detectProvider(): LLMProvider {
    const explicit = process.env.LLM_PROVIDER?.toLowerCase();
    if (explicit === "openai" && process.env.OPENAI_API_KEY) return "openai";
    if (explicit === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
    if (explicit === "copilot") return "copilot";

    // Auto-detect: prefer copilot (no key needed), fall back to others
    if (process.env.OPENAI_API_KEY) return "openai";
    if (process.env.ANTHROPIC_API_KEY) return "anthropic";
    return "copilot";
  }

  private getModelName(): string {
    if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
    switch (this.provider) {
      case "copilot": return "claude-3.5-haiku";
      case "openai": return "gpt-4o-mini";
      case "anthropic": return "claude-3-5-sonnet-20241022";
    }
  }

  private initializeModel(): void {
    switch (this.provider) {
      case "copilot":
        if (this.copilotAuth.isAuthenticated) {
          this.model = createCopilotModel(this.copilotAuth, this.modelName);
          console.log(`✅ LLM Client: GitHub Copilot (${this.modelName})`);
        } else {
          this.model = null;
          console.log("⏳ LLM Client: Copilot selected, awaiting login...");
          this.webContents.send("auth-required");
        }
        break;
      case "openai":
        this.model = openai(this.modelName);
        console.log(`✅ LLM Client: OpenAI (${this.modelName})`);
        break;
      case "anthropic":
        this.model = anthropic(this.modelName);
        console.log(`✅ LLM Client: Anthropic (${this.modelName})`);
        break;
    }
  }

  /**
   * Called after successful device flow login to initialize the model.
   */
  onAuthComplete(): void {
    if (this.provider === "copilot" && this.copilotAuth.isAuthenticated) {
      this.model = createCopilotModel(this.copilotAuth, this.modelName);
      console.log(`✅ LLM Client: GitHub Copilot ready (${this.modelName})`);
      this.webContents.send("auth-complete");
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      // Get screenshot from active tab if available
      let screenshot: string | null = null;
      if (this.window) {
        const activeTab = this.window.activeTab;
        if (activeTab) {
          try {
            const image = await activeTab.screenshot();
            screenshot = image.toDataURL();
          } catch (error) {
            console.error("Failed to capture screenshot:", error);
          }
        }
      }

      // Build user message content with screenshot first, then text
      const userContent: any[] = [];

      if (screenshot) {
        userContent.push({
          type: "image",
          image: screenshot,
        });
      }

      userContent.push({
        type: "text",
        text: request.message,
      });

      const userMessage: CoreMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };

      this.messages.push(userMessage);
      this.sendMessagesToRenderer();

      if (!this.model) {
        if (this.provider === "copilot" && !this.copilotAuth.isAuthenticated) {
          this.sendErrorMessage(
            request.messageId,
            "Please sign in with GitHub to use Copilot. Click the button above to start."
          );
        } else {
          this.sendErrorMessage(
            request.messageId,
            "LLM service is not configured. Please add your API key to the .env file."
          );
        }
        return;
      }

      const messages = await this.prepareMessagesWithContext(request);
      await this.streamResponse(messages, request.messageId);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(_request: ChatRequest): Promise<CoreMessage[]> {
    let pageUrl: string | null = null;
    let pageText: string | null = null;

    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        try {
          pageText = await activeTab.getTabText();
        } catch (error) {
          console.error("Failed to get page text:", error);
        }
      }
    }

    const systemMessage: CoreMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(url: string | null, pageText: string | null): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser called Blueberry Browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided."
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    const result = await streamText({
      model: this.model,
      messages,
      temperature: DEFAULT_TEMPERATURE,
      maxRetries: 3,
    });

    await this.processStream(result.textStream, messageId);
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string
  ): Promise<void> {
    let accumulatedText = "";

    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: "",
    };

    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);

    for await (const chunk of textStream) {
      accumulatedText += chunk;

      this.messages[messageIndex] = {
        role: "assistant",
        content: accumulatedText,
      };
      this.sendMessagesToRenderer();

      this.sendStreamChunk(messageId, {
        content: chunk,
        isComplete: false,
      });
    }

    this.messages[messageIndex] = {
      role: "assistant",
      content: accumulatedText,
    };
    this.sendMessagesToRenderer();

    this.sendStreamChunk(messageId, {
      content: accumulatedText,
      isComplete: true,
    });
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);
    const errorMessage = this.getErrorMessage(error);
    this.sendErrorMessage(messageId, errorMessage);
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const message = error.message.toLowerCase();

    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Your GitHub token may have expired. Please sign in again.";
    }

    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }

    if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
      return "Network error: Please check your internet connection.";
    }

    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }
}
