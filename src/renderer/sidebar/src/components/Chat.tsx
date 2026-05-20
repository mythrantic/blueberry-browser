import React, { useState, useRef, useEffect, useLayoutEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { ArrowUp, Plus, Zap } from 'lucide-react'
import { useChat } from '../contexts/ChatContext'
import { cn } from '@common/lib/utils'
import { Button } from '@common/components/Button'
import { AuthPrompt } from './AuthPrompt'

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    isStreaming?: boolean
}

// Auto-scroll hook
const useAutoScroll = (messages: Message[]) => {
    const scrollRef = useRef<HTMLDivElement>(null)

    useLayoutEffect(() => {
        scrollRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'end'
        })
    }, [messages.length, messages[messages.length - 1]?.content])

    return scrollRef
}

// User Message Component
const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <div className="relative max-w-[85%] ml-auto animate-fade-in">
        <div className="bg-muted dark:bg-muted/50 rounded-3xl px-6 py-4">
            <div className="text-foreground" style={{ whiteSpace: 'pre-wrap' }}>
                {content}
            </div>
        </div>
    </div>
)

// Streaming Text Component
const StreamingText: React.FC<{ content: string }> = ({ content }) => (
    <div className="text-foreground">
        <Markdown content={content} />
        <span className="inline-block w-2 h-5 bg-primary/60 dark:bg-primary/40 ml-0.5 animate-pulse" />
    </div>
)

// Markdown Renderer
const Markdown: React.FC<{ content: string }> = ({ content }) => (
    <div className="prose prose-sm dark:prose-invert max-w-none 
                    prose-headings:text-foreground prose-p:text-foreground 
                    prose-strong:text-foreground prose-ul:text-foreground 
                    prose-ol:text-foreground prose-li:text-foreground
                    prose-a:text-primary hover:prose-a:underline
                    prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 
                    prose-code:rounded prose-code:text-sm prose-code:text-foreground
                    prose-pre:bg-muted dark:prose-pre:bg-muted/50 prose-pre:p-3 
                    prose-pre:rounded-lg prose-pre:overflow-x-auto">
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkBreaks]}
            components={{
                code: ({ node, className, children, ...props }) => {
                    const inline = !className
                    return inline ? (
                        <code className="bg-muted dark:bg-muted/50 px-1 py-0.5 rounded text-sm text-foreground" {...props}>
                            {children}
                        </code>
                    ) : (
                        <code className={className} {...props}>
                            {children}
                        </code>
                    )
                },
                a: ({ children, href }) => (
                    <a href={href} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                        {children}
                    </a>
                ),
            }}
        >
            {content}
        </ReactMarkdown>
    </div>
)

// Agent Steps Component - shows real-time tool activity
const AgentSteps: React.FC<{ steps: { name: string; args: string }[]; isActive: boolean }> = ({ steps, isActive }) => {
    if (steps.length === 0 && !isActive) return null

    return (
        <div className="mb-3 rounded-xl border border-border/50 bg-muted/30 dark:bg-muted/10 overflow-hidden">
            <div className="px-3 py-2 border-b border-border/30 flex items-center gap-2">
                {isActive && <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />}
                <span className="text-xs font-medium text-muted-foreground">
                    {isActive ? 'Working...' : `Completed ${steps.length} action${steps.length > 1 ? 's' : ''}`}
                </span>
            </div>
            <div className="divide-y divide-border/20">
                {steps.map((step, i) => (
                    <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                        <Zap className="w-3 h-3 text-yellow-500 shrink-0" />
                        <span className="font-medium text-foreground">{step.name}</span>
                        {step.args && step.args !== '{}' && (
                            <span className="text-muted-foreground truncate max-w-[200px]">
                                {(() => {
                                    try {
                                        const parsed = JSON.parse(step.args)
                                        const val = parsed.url || parsed.code?.substring(0, 40) || ''
                                        return val ? `→ ${val}` : ''
                                    } catch { return '' }
                                })()}
                            </span>
                        )}
                    </div>
                ))}
                {isActive && (
                    <div className="px-3 py-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="w-3 h-3 flex items-center justify-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
                        </span>
                        <span>Thinking...</span>
                    </div>
                )}
            </div>
        </div>
    )
}

// Assistant Message Component
const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean; toolCalls?: { name: string; args: string }[]; isTooling?: boolean }> = ({
    content,
    isStreaming,
    toolCalls,
    isTooling
}) => (
    <div className="relative w-full animate-fade-in">
        <AgentSteps steps={toolCalls || []} isActive={isTooling || false} />
        <div className="py-1">
            {isStreaming ? (
                <StreamingText content={content} />
            ) : content ? (
                <Markdown content={content} />
            ) : null}
        </div>
    </div>
)

// Loading Indicator
const LoadingIndicator: React.FC = () => (
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span>Thinking...</span>
    </div>
)

// Chat Input Component
const ChatInput: React.FC<{
    onSend: (message: string) => void
    disabled: boolean
}> = ({ onSend, disabled }) => {
    const [value, setValue] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [isFocused, setIsFocused] = useState(false)

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            const scrollHeight = textareaRef.current.scrollHeight
            textareaRef.current.style.height = `${Math.min(scrollHeight, 200)}px`
        }
    }, [value])

    const handleSubmit = () => {
        if (value.trim() && !disabled) {
            onSend(value.trim())
            setValue('')
            if (textareaRef.current) textareaRef.current.style.height = '24px'
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
        }
    }

    return (
        <div className={cn(
            "w-full border p-3 rounded-3xl bg-background dark:bg-secondary",
            "shadow-chat animate-spring-scale outline-none transition-all duration-200",
            isFocused ? "border-primary/20 dark:border-primary/30" : "border-border"
        )}>
            <div className="w-full px-3 py-2">
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onKeyDown={handleKeyDown}
                    placeholder="Send a message..."
                    className="w-full resize-none outline-none bg-transparent text-foreground placeholder:text-muted-foreground min-h-[24px] max-h-[200px]"
                    rows={1}
                    style={{ lineHeight: '24px' }}
                />
            </div>
            <div className="w-full flex items-center gap-1.5 px-1 mt-2 mb-1">
                <div className="flex-1" />
                <button
                    onClick={handleSubmit}
                    disabled={disabled || !value.trim()}
                    className={cn(
                        "size-9 rounded-full flex items-center justify-center",
                        "transition-all duration-200",
                        "bg-primary text-primary-foreground",
                        "hover:opacity-80 disabled:opacity-50"
                    )}
                >
                    <ArrowUp className="size-5" />
                </button>
            </div>
        </div>
    )
}

// Conversation Turn Component
interface ConversationTurn {
    user?: Message
    assistant?: Message
}

const ConversationTurnComponent: React.FC<{
    turn: ConversationTurn
    isLoading?: boolean
    toolCalls?: { name: string; args: string }[]
    isTooling?: boolean
}> = ({ turn, isLoading, toolCalls, isTooling }) => (
    <div className="pt-12 flex flex-col gap-8">
        {turn.user && <UserMessage content={turn.user.content} />}
        {(turn.assistant || isTooling || (toolCalls && toolCalls.length > 0)) && (
            <AssistantMessage
                content={turn.assistant?.content || ''}
                isStreaming={turn.assistant?.isStreaming}
                toolCalls={toolCalls}
                isTooling={isTooling}
            />
        )}
        {isLoading && !isTooling && !(toolCalls && toolCalls.length > 0) && (
            <div className="flex justify-start">
                <LoadingIndicator />
            </div>
        )}
    </div>
)

// Main Chat Component
export const Chat: React.FC = () => {
    const { messages, isLoading, sendMessage, clearChat, isAuthenticated } = useChat()
    const scrollRef = useAutoScroll(messages)
    const [toolCalls, setToolCalls] = useState<{ name: string; args: string }[]>([])
    const [completedToolCalls, setCompletedToolCalls] = useState<{ name: string; args: string }[]>([])

    // Listen for agent step events (real-time tool activity)
    useEffect(() => {
        const api = window.sidebarAPI
        api.onAgentStep?.((step: any) => {
            if (step.type === 'act') {
                setToolCalls(prev => [...prev, { name: step.description, args: step.detail || '' }])
            }
        })
        return () => {
            api.removeAgentListeners?.()
        }
    }, [])

    // When loading finishes, move tool calls to completed state
    useEffect(() => {
        if (!isLoading && toolCalls.length > 0) {
            setCompletedToolCalls(toolCalls)
            setToolCalls([])
        }
        if (isLoading) {
            setCompletedToolCalls([])
            setToolCalls([])
        }
    }, [isLoading])

    // Group messages into conversation turns
    const conversationTurns: ConversationTurn[] = []
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            const turn: ConversationTurn = { user: messages[i] }
            if (messages[i + 1]?.role === 'assistant') {
                turn.assistant = messages[i + 1]
                i++
            }
            conversationTurns.push(turn)
        } else if (messages[i].role === 'assistant' &&
            (i === 0 || messages[i - 1]?.role !== 'user')) {
            conversationTurns.push({ assistant: messages[i] })
        }
    }

    const showLoadingAfterLastTurn = isLoading &&
        messages[messages.length - 1]?.role === 'user'

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="flex-1 overflow-y-auto">
                <div className="h-8 max-w-3xl mx-auto px-4">
                    {messages.length > 0 && (
                        <Button onClick={clearChat} title="Start new chat" variant="ghost">
                            <Plus className="size-4" />
                            New Chat
                        </Button>
                    )}
                </div>

                <div className="pb-4 relative max-w-3xl mx-auto px-4">
                    {!isAuthenticated ? (
                        <AuthPrompt />
                    ) : messages.length === 0 ? (
                        <div className="flex items-center justify-center h-full min-h-[400px]">
                            <div className="text-center animate-fade-in max-w-md mx-auto gap-2 flex flex-col">
                                <h3 className="text-2xl font-bold">🫐</h3>
                                <p className="text-muted-foreground text-sm">
                                    Press ⌘E to toggle the sidebar
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {conversationTurns.map((turn, index) => (
                                <ConversationTurnComponent
                                    key={`turn-${index}`}
                                    turn={turn}
                                    isLoading={
                                        showLoadingAfterLastTurn &&
                                        index === conversationTurns.length - 1
                                    }
                                    toolCalls={
                                        index === conversationTurns.length - 1
                                            ? (toolCalls.length > 0 ? toolCalls : completedToolCalls)
                                            : undefined
                                    }
                                    isTooling={
                                        isLoading &&
                                        index === conversationTurns.length - 1 &&
                                        toolCalls.length > 0
                                    }
                                />
                            ))}
                        </>
                    )}

                    <div ref={scrollRef} />
                </div>
            </div>

            {isAuthenticated && (
                <div className="p-4">
                    <ChatInput onSend={sendMessage} disabled={isLoading} />
                </div>
            )}
        </div>
    )
}
