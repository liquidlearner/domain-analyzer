"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Bot, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { trpc } from '@/lib/trpc'
import { useAiStream } from '@/hooks/use-ai-stream'
import { MessageBubble } from './message-bubble'
import { QuickActions } from './quick-actions'
import { ChatInput } from './chat-input'
import { ConversationSelector } from './conversation-selector'
import { QUICK_ACTION_LABELS, type QuickActionType } from '@/server/services/ai/prompts'
import { cn } from '@/lib/utils'

interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
  action?: string
}

interface AdvisorPanelProps {
  evaluationId: string
  isOpen: boolean
  onClose: () => void
}

export function AdvisorPanel({ evaluationId, isOpen, onClose }: AdvisorPanelProps) {
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // tRPC queries
  const { data: conversations, refetch: refetchConversations } =
    trpc.ai.listConversations.useQuery(
      { evaluationId },
      { enabled: isOpen }
    )

  const { data: loadedMessages } = trpc.ai.getConversation.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId && isOpen }
  )

  const deleteMutation = trpc.ai.deleteConversation.useMutation({
    onSuccess: () => {
      refetchConversations()
      if (conversations && conversations.length > 1) {
        const remaining = conversations.filter(c => c.id !== conversationId)
        if (remaining.length > 0) {
          setConversationId(remaining[0].id)
        } else {
          handleNewConversation()
        }
      } else {
        handleNewConversation()
      }
    },
  })

  // Streaming hook
  const { streamingText, isStreaming, error, sendMessage, abort } = useAiStream({
    onConversationId: (id) => {
      setConversationId(id)
      refetchConversations()
    },
    onComplete: (fullText) => {
      setMessages(prev => [...prev, { role: 'assistant', content: fullText }])
      refetchConversations()
    },
  })

  // Load messages when conversation changes
  useEffect(() => {
    if (loadedMessages) {
      setMessages(loadedMessages.map(m => ({
        role: m.role,
        content: m.content,
        action: m.action,
      })))
    }
  }, [loadedMessages])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  const handleSend = useCallback((message: string, action?: string) => {
    // Add user message to display immediately
    const displayMessage = action
      ? QUICK_ACTION_LABELS[action as QuickActionType] || message
      : message

    setMessages(prev => [...prev, { role: 'user', content: displayMessage, action }])

    sendMessage({
      evaluationId,
      conversationId,
      message,
      action,
    })
  }, [evaluationId, conversationId, sendMessage])

  const handleQuickAction = useCallback((action: QuickActionType) => {
    handleSend(QUICK_ACTION_LABELS[action], action)
  }, [handleSend])

  const handleNewConversation = useCallback(() => {
    setConversationId(undefined)
    setMessages([])
  }, [])

  const handleSelectConversation = useCallback((id: string) => {
    setConversationId(id)
  }, [])

  const handleDeleteConversation = useCallback((id: string) => {
    deleteMutation.mutate({ conversationId: id })
  }, [deleteMutation])

  const handleExport = useCallback(() => {
    const md = messages
      .map(m => `**${m.role === 'user' ? 'You' : 'AI Advisor'}:**\n\n${m.content}`)
      .join('\n\n---\n\n')
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `migration-advisor-${new Date().toISOString().split('T')[0]}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [messages])

  return (
    <div
      className={cn(
        'fixed top-0 right-0 h-full bg-white border-l border-zinc-200 shadow-xl z-50 flex flex-col transition-transform duration-300',
        'w-full md:w-[480px] lg:w-[520px]',
        isOpen ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 bg-zinc-50">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-sm">AI Migration Advisor</h2>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleExport} className="h-7 px-2" title="Export as Markdown">
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Conversation selector */}
      {conversations && conversations.length > 0 && (
        <ConversationSelector
          conversations={conversations}
          activeId={conversationId}
          onSelect={handleSelectConversation}
          onNew={handleNewConversation}
          onDelete={handleDeleteConversation}
        />
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-8">
            <Bot className="h-10 w-10 text-zinc-300 mx-auto mb-3" />
            <p className="text-sm text-zinc-500 mb-1">AI Migration Advisor</p>
            <p className="text-xs text-zinc-400 mb-4">
              Ask questions about this migration assessment or use a quick action to get started.
            </p>
            <QuickActions onAction={handleQuickAction} disabled={isStreaming} />
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}

        {/* Streaming response */}
        {isStreaming && streamingText && (
          <MessageBubble role="assistant" content={streamingText} isStreaming />
        )}

        {/* Streaming without text yet — typing indicator */}
        {isStreaming && !streamingText && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0">
              <Bot className="h-3.5 w-3.5 text-zinc-600" />
            </div>
            <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick actions bar (shown when conversation has messages) */}
      {messages.length > 0 && !isStreaming && (
        <div className="px-3 py-2 border-t border-zinc-100">
          <QuickActions onAction={handleQuickAction} disabled={isStreaming} />
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onStop={abort}
        disabled={false}
        isStreaming={isStreaming}
      />
    </div>
  )
}
