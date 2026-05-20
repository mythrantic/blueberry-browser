import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    isStreaming?: boolean
}

interface ChatContextType {
    messages: Message[]
    isLoading: boolean
    isAuthenticated: boolean

    // Chat actions
    sendMessage: (content: string) => Promise<void>
    clearChat: () => void

    // Page content access
    getPageContent: () => Promise<string | null>
    getPageText: () => Promise<string | null>
    getCurrentUrl: () => Promise<string | null>
}

const ChatContext = createContext<ChatContextType | null>(null)

export const useChat = () => {
    const context = useContext(ChatContext)
    if (!context) {
        throw new Error('useChat must be used within a ChatProvider')
    }
    return context
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoadingState] = useState(false)
    const isLoadingRef = useRef(false)
    const setIsLoading = (v: boolean) => { isLoadingRef.current = v; setIsLoadingState(v) }
    const [isAuthenticated, setIsAuthenticated] = useState(false)

    // Check auth status on mount
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const status = await window.sidebarAPI.getCopilotAuthStatus()
                setIsAuthenticated(status.isAuthenticated)
            } catch {
                setIsAuthenticated(false)
            }
        }
        checkAuth()

        window.sidebarAPI.onAuthRequired(() => setIsAuthenticated(false))
        window.sidebarAPI.onAuthComplete(() => setIsAuthenticated(true))

        return () => {
            window.sidebarAPI.removeAuthListeners()
        }
    }, [])

    // Load initial messages from main process
    useEffect(() => {
        const loadMessages = async () => {
            try {
                const storedMessages = await window.sidebarAPI.getMessages()
                if (storedMessages && storedMessages.length > 0) {
                    // Convert CoreMessage format to our frontend Message format
                    const convertedMessages = storedMessages.map((msg: any, index: number) => ({
                        id: `msg-${index}`,
                        role: msg.role,
                        content: typeof msg.content === 'string' 
                            ? msg.content 
                            : msg.content.find((p: any) => p.type === 'text')?.text || '',
                        timestamp: Date.now(),
                        isStreaming: false
                    }))
                    setMessages(convertedMessages)
                }
            } catch (error) {
                console.error('Failed to load messages:', error)
            }
        }
        loadMessages()
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        setIsLoading(true)

        // Add user message immediately
        setMessages(prev => [...prev, {
            id: `user-${Date.now()}`,
            role: 'user',
            content,
            timestamp: Date.now(),
            isStreaming: false
        }])

        try {
            const messageId = Date.now().toString()
            await window.sidebarAPI.sendChatMessage({
                message: content,
                messageId: messageId
            })
            // isLoading will be set to false when chat-response with isComplete arrives
        } catch (error) {
            console.error('Failed to send message:', error)
            setIsLoading(false)
        }
    }, [])

    const clearChat = useCallback(async () => {
        try {
            await window.sidebarAPI.clearChat()
            setMessages([])
        } catch (error) {
            console.error('Failed to clear chat:', error)
        }
    }, [])

    const getPageContent = useCallback(async () => {
        try {
            return await window.sidebarAPI.getPageContent()
        } catch (error) {
            console.error('Failed to get page content:', error)
            return null
        }
    }, [])

    const getPageText = useCallback(async () => {
        try {
            return await window.sidebarAPI.getPageText()
        } catch (error) {
            console.error('Failed to get page text:', error)
            return null
        }
    }, [])

    const getCurrentUrl = useCallback(async () => {
        try {
            return await window.sidebarAPI.getCurrentUrl()
        } catch (error) {
            console.error('Failed to get current URL:', error)
            return null
        }
    }, [])

    // Set up message listeners
    useEffect(() => {
        // Listen for streaming response updates - accumulate text in real-time
        const handleChatResponse = (data: { messageId: string; content: string; isComplete: boolean }) => {
            if (data.content) {
                // Update or create streaming assistant message
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1]
                    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                        // Append to existing streaming message
                        return prev.map((msg, i) =>
                            i === prev.length - 1
                                ? { ...msg, content: msg.content + data.content }
                                : msg
                        )
                    } else {
                        // Create new streaming message
                        return [...prev, {
                            id: `stream-${data.messageId}`,
                            role: 'assistant' as const,
                            content: data.content,
                            timestamp: Date.now(),
                            isStreaming: true
                        }]
                    }
                })
            }
            if (data.isComplete) {
                // Mark streaming as done
                setMessages(prev => prev.map(msg =>
                    msg.isStreaming ? { ...msg, isStreaming: false } : msg
                ))
                setIsLoading(false)
            }
        }

        // Listen for message updates from main process (final state)
        const handleMessagesUpdated = (updatedMessages: any[]) => {
            const lastIndex = updatedMessages.length - 1
            const convertedMessages = updatedMessages.map((msg: any, index: number) => ({
                id: `msg-${index}`,
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content?.find?.((p: any) => p.type === 'text')?.text || '',
                timestamp: Date.now(),
                isStreaming: index === lastIndex && msg.role === 'assistant' && isLoadingRef.current
            }))
            setMessages(convertedMessages)
        }

        window.sidebarAPI.onChatResponse(handleChatResponse)
        window.sidebarAPI.onMessagesUpdated(handleMessagesUpdated)

        return () => {
            window.sidebarAPI.removeChatResponseListener()
            window.sidebarAPI.removeMessagesUpdatedListener()
        }
    }, [])

    const value: ChatContextType = {
        messages,
        isLoading,
        isAuthenticated,
        sendMessage,
        clearChat,
        getPageContent,
        getPageText,
        getCurrentUrl
    }

    return (
        <ChatContext.Provider value={value}>
            {children}
        </ChatContext.Provider>
    )
}

