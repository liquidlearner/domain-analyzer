"use client"

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, User, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

export function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isUser = role === 'user'

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={cn(
        'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center',
        isUser ? 'bg-primary text-white' : 'bg-zinc-100 text-zinc-600'
      )}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      <div className={cn(
        'group relative max-w-[85%] rounded-lg px-4 py-3',
        isUser
          ? 'bg-primary text-white'
          : 'bg-zinc-50 border border-zinc-200 text-zinc-900'
      )}>
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="text-sm prose prose-sm prose-zinc max-w-none
            prose-headings:text-zinc-900 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
            prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
            prose-strong:text-zinc-900 prose-code:text-zinc-800 prose-code:bg-zinc-100 prose-code:px-1 prose-code:rounded
            prose-pre:bg-zinc-800 prose-pre:text-zinc-100
            prose-table:text-sm prose-th:text-left prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {isStreaming && <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5" />}
          </div>
        )}

        {!isUser && !isStreaming && content && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200"
            title="Copy to clipboard"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-zinc-400" />}
          </button>
        )}
      </div>
    </div>
  )
}
