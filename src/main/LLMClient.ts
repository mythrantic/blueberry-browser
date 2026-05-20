import { WebContents } from "electron";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import { CopilotAuth } from "./copilot";
import { COPILOT_CHAT_BASE_URL, copilotRequestHeaders } from "./copilot/constants";

dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | any[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "execute",
      description: "Run JavaScript in the browser page. Use for clicking, typing, reading. Return a string.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "JS code to run in page. Can use await." },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate",
      description: "Navigate the browser to a URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to go to" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_page_info",
      description: "Get text map of all interactive elements on the current page.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const SYSTEM_PROMPT = `You are a browser automation assistant in Blueberry Browser.

RULES:
- Act first, talk after. Use tools to accomplish tasks.
- Never refuse. Never ask clarifying questions. Just do it.
- Never suggest manual steps. YOU do everything.
- Use execute() to run JS in the page (click buttons, fill forms, read content).
- Use navigate() to go to URLs.
- Use get_page_info() to see interactive elements on the page.
- After completing the task, ALWAYS give a summary of what you found/did. This is critical.
- If a tool returns an error, try a different approach. Don't give up.

JS TIPS for execute():
- Code runs inside async IIFE. You can use const/let, await, multiple statements.
- ALWAYS null-check: const el = document.querySelector('a[href*=repo]'); if(el) el.click(); else return 'not found'
- Click by text: const el = [...document.querySelectorAll('a,button')].find(e=>e.textContent.includes('TEXT')); if(el){el.click(); return 'clicked'} else {return 'not found'}
- Read text: return document.querySelector('h1')?.textContent || 'not found'
- Read page: return document.body.innerText.substring(0,3000)
- Fill: const el=document.querySelector('input'); el.value='hi'; el.dispatchEvent(new Event('input',{bubbles:true})); return 'filled'
- Scroll: window.scrollBy(0,500); return 'scrolled'
- Use "return" to get values back.`;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private messages: Message[] = [];
  private copilotAuth: CopilotAuth;

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.copilotAuth = new CopilotAuth();

    if (this.copilotAuth.isAuthenticated) {
      console.log("✅ LLM Client: GitHub Copilot (claude-opus-4.6)");
    } else {
      console.log("⏳ LLM Client: Copilot awaiting login...");
      this.webContents.send("auth-required");
    }
  }

  setWindow(window: Window): void {
    this.window = window;
  }

  get auth(): CopilotAuth {
    return this.copilotAuth;
  }

  onAuthComplete(): void {
    if (this.copilotAuth.isAuthenticated) {
      console.log("✅ LLM Client: GitHub Copilot ready (claude-opus-4.6)");
      this.webContents.send("auth-complete");
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      if (!this.copilotAuth.isAuthenticated) {
        this.sendStreamChunk(request.messageId, { content: "Please sign in with GitHub first.", isComplete: true });
        return;
      }

      // Build user message
      const userContent: any[] = [];
      userContent.push({ type: "text", text: request.message });

      this.messages.push({ role: "user", content: request.message });
      this.webContents.send("chat-messages-updated", this.getDisplayMessages());

      await this.runAgentLoop(request.messageId);
    } catch (error: any) {
      console.error("LLM Error:", error);
      this.sendStreamChunk(request.messageId, { content: `Error: ${error.message}`, isComplete: true });
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.webContents.send("chat-messages-updated", this.getDisplayMessages());
  }

  getMessages(): Message[] {
    return this.getDisplayMessages();
  }

  private async runAgentLoop(messageId: string): Promise<void> {
    let fullText = "";
    let step = 0;

    for (;;) {
      step++;
      console.log(`  📍 Step ${step}, messages: ${this.messages.length}`);

      const apiMessages: Message[] = [
        { role: "system", content: SYSTEM_PROMPT + `\n\nCurrent URL: ${this.window?.activeTab?.url || "about:blank"}` },
        ...this.messages,
      ];

      const response = await this.callCopilot(apiMessages);
      console.log(`  📍 Step ${step} response: text=${!!response.content} (${(response.content||'').length} chars), tools=${response.tool_calls?.length || 0}`);

      // Stream text content
      if (response.content) {
        fullText += response.content;
        this.sendStreamChunk(messageId, { content: response.content, isComplete: false });
      }

      // If no tool calls, we're done
      if (!response.tool_calls || response.tool_calls.length === 0) {
        console.log(`  ✅ Loop done at step ${step}. fullText length: ${fullText.length}`);
        break;
      }

      // Add assistant message with tool calls
      this.messages.push({ role: "assistant", content: response.content || undefined, tool_calls: response.tool_calls });

      // Execute tools and add results
      for (const tc of response.tool_calls) {
        const result = await this.executeTool(tc.function.name, tc.function.arguments);
        console.log(`  🔧 ${tc.function.name} → ${result.substring(0, 80)}`);
        this.messages.push({ role: "tool", content: result, tool_call_id: tc.id });
      }
    }

    // If no text was produced, force a final summary (call without tools)
    if (!fullText) {
      console.log(`  📍 Forcing summary call (no text produced)`);
      this.messages.push({ role: "user", content: "Summarize what you found. Answer my original question." });
      const summary = await this.callCopilot([
        { role: "system", content: "You are a helpful assistant. Answer the user's question based on the conversation so far. Be concise." },
        ...this.messages,
      ], false);
      console.log(`  📍 Summary response: ${(summary.content||'').length} chars`);
      if (summary.content) {
        fullText = summary.content;
        this.sendStreamChunk(messageId, { content: summary.content, isComplete: false });
      }
      // Remove the injected prompt from history
      this.messages.pop();
    }

    // Final message
    if (fullText) {
      this.messages.push({ role: "assistant", content: fullText });
    }
    this.webContents.send("chat-messages-updated", this.getDisplayMessages());
    this.sendStreamChunk(messageId, { content: "", isComplete: true });
  }

  /** Return only user/assistant messages with actual content for the frontend */
  private getDisplayMessages(): Message[] {
    return this.messages.filter(m => {
      if (m.role === "user") return typeof m.content === "string";
      if (m.role === "assistant") return !!m.content && !m.tool_calls;
      return false;
    });
  }

  private async callCopilot(messages: Message[], includeTools: boolean = true): Promise<{ content: string; tool_calls?: ToolCall[] }> {
    const token = await this.copilotAuth.ensureCopilotToken();
    const headers = copilotRequestHeaders(token);

    const body: any = {
      model: "claude-opus-4.6",
      messages,
      stream: true,
    };
    if (includeTools) body.tools = TOOLS;

    const res = await fetch(`${COPILOT_CHAT_BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Copilot API ${res.status}: ${text}`);
    }

    // Parse SSE stream
    return this.parseSSE(res);
  }

  private async parseSSE(res: Response): Promise<{ content: string; tool_calls?: ToolCall[] }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let content = "";
    const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            content += delta.content;
          }

          // Tool calls (streamed incrementally)
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls.has(idx)) {
                toolCalls.set(idx, { id: tc.id || "", name: tc.function?.name || "", args: "" });
              }
              const existing = toolCalls.get(idx)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.args += tc.function.arguments;
            }
          }
        } catch {}
      }
    }

    const result: { content: string; tool_calls?: ToolCall[] } = { content };
    if (toolCalls.size > 0) {
      result.tool_calls = [...toolCalls.values()].map(tc => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.args },
      }));
    }
    return result;
  }

  private async executeTool(name: string, argsJson: string): Promise<string> {
    const tab = this.window?.activeTab;
    if (!tab) return "Error: no active tab";

    let args: any;
    try { args = JSON.parse(argsJson); } catch { return `Error: invalid args: ${argsJson}`; }

    switch (name) {
      case "navigate": {
        try {
          await tab.loadURL(args.url);
          await new Promise(r => setTimeout(r, 2000));
          return `Navigated to ${args.url}`;
        } catch (e: any) { return `Error: ${e.message}`; }
      }
      case "execute": {
        try {
          // Electron executeJavaScript evaluates expressions only.
          // Wrap in an async IIFE. The code from the model may be an expression or statements.
          const code = args.code.trim();
          // Try as expression first, fall back to statements
          let result: any;
          try {
            result = await tab.runJs(`(async()=>{${code}})().then(r=>r===undefined?'done':String(r)).catch(e=>'Error: '+e.message)`);
          } catch {
            // If that fails, try wrapping as a return expression
            try {
              result = await tab.runJs(`(async()=>{ return (${code}) })().then(r=>r===undefined?'done':String(r)).catch(e=>'Error: '+e.message)`);
            } catch (e2: any) {
              result = `Error: ${e2.message}`;
            }
          }
          await new Promise(r => setTimeout(r, 500));
          return result !== undefined && result !== null ? String(result) : "done";
        } catch (e: any) { return `Error: ${e.message}`; }
      }
      case "get_page_info": {
        try {
          const info = await tab.runJs(`
            (function() {
              const els = document.querySelectorAll('a,button,[role="button"],input,textarea,select,[onclick]');
              return Array.from(els).slice(0,50).map(el => {
                const tag = el.tagName.toLowerCase();
                const text = (el.innerText||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim().substring(0,60);
                const href = el.getAttribute('href')||'';
                return text ? tag+': '+text+(href?' → '+href.substring(0,40):''): null;
              }).filter(Boolean).join('\\n');
            })()
          `);
          return `URL: ${tab.url}\n\n${info || "(empty page)"}`;
        } catch (e: any) { return `Error: ${e.message}`; }
      }
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", { messageId, content: chunk.content, isComplete: chunk.isComplete });
  }
}
