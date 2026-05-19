import React, { useState } from 'react'

type AuthState = 'idle' | 'waiting' | 'polling' | 'success' | 'error'

export const AuthPrompt: React.FC = () => {
    const [authState, setAuthState] = useState<AuthState>('idle')
    const [userCode, setUserCode] = useState<string>('')
    const [verificationUri, setVerificationUri] = useState<string>('')
    const [error, setError] = useState<string>('')

    const startLogin = async () => {
        setAuthState('waiting')
        setError('')

        try {
            const result = await window.sidebarAPI.startCopilotLogin()

            if (!result.success) {
                setAuthState('error')
                setError(result.error || 'Failed to start login')
                return
            }

            setUserCode(result.userCode!)
            setVerificationUri(result.verificationUri!)
            setAuthState('polling')

            // Open verification URI in external browser
            window.open(result.verificationUri, '_blank')

            // Start polling for token
            const pollResult = await window.sidebarAPI.pollCopilotToken(
                result.deviceCode!,
                result.interval!,
                result.expiresIn!
            )

            if (pollResult.success) {
                setAuthState('success')
            } else {
                setAuthState('error')
                setError(pollResult.error || 'Authentication failed')
            }
        } catch (err) {
            setAuthState('error')
            setError(String(err))
        }
    }

    if (authState === 'success') {
        return null
    }

    return (
        <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-6">
            <div className="text-center animate-fade-in max-w-sm mx-auto flex flex-col gap-4">
                <h3 className="text-3xl">🫐</h3>
                <h2 className="text-lg font-semibold text-foreground">
                    Blueberry Browser
                </h2>

                {authState === 'idle' && (
                    <>
                        <p className="text-sm text-muted-foreground">
                            Sign in with GitHub to use AI features powered by Copilot.
                        </p>
                        <button
                            onClick={startLogin}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity font-medium"
                        >
                            Sign in with GitHub
                        </button>
                    </>
                )}

                {authState === 'waiting' && (
                    <p className="text-sm text-muted-foreground">
                        Starting authentication...
                    </p>
                )}

                {authState === 'polling' && (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm text-muted-foreground">
                            Enter this code at{' '}
                            <a
                                href={verificationUri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline"
                            >
                                github.com/login/device
                            </a>
                        </p>
                        <div className="bg-muted rounded-lg px-4 py-3 font-mono text-2xl font-bold text-foreground tracking-widest">
                            {userCode}
                        </div>
                        <p className="text-xs text-muted-foreground animate-pulse">
                            Waiting for authorization...
                        </p>
                    </div>
                )}

                {authState === 'error' && (
                    <div className="flex flex-col gap-3">
                        <p className="text-sm text-red-500">{error}</p>
                        <button
                            onClick={startLogin}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity font-medium"
                        >
                            Try Again
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
