"use client"

import { Plus, Trash2, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Conversation {
  id: string
  title: string | null
  createdAt: Date
  updatedAt: Date
}

interface ConversationSelectorProps {
  conversations: Conversation[]
  activeId?: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function ConversationSelector({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: ConversationSelectorProps) {
  if (conversations.length === 0) return null

  return (
    <div className="border-b border-zinc-200 p-2 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-zinc-500 px-1">Conversations</span>
        <Button variant="ghost" size="sm" onClick={onNew} className="h-6 px-2 text-xs">
          <Plus className="h-3 w-3 mr-1" />
          New
        </Button>
      </div>
      <div className="max-h-32 overflow-y-auto space-y-0.5">
        {conversations.map(conv => (
          <div
            key={conv.id}
            className={cn(
              'group flex items-center gap-1.5 px-2 py-1.5 rounded text-xs cursor-pointer',
              activeId === conv.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-zinc-600 hover:bg-zinc-100'
            )}
            onClick={() => onSelect(conv.id)}
          >
            <MessageSquare className="h-3 w-3 flex-shrink-0" />
            <span className="flex-1 truncate">{conv.title || 'Untitled'}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-200"
            >
              <Trash2 className="h-3 w-3 text-zinc-400 hover:text-red-500" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
