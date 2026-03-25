"use client"

import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AdvisorToggleProps {
  onClick: () => void
}

export function AdvisorToggle({ onClick }: AdvisorToggleProps) {
  return (
    <Button
      onClick={onClick}
      variant="outline"
      size="sm"
      className="gap-1.5"
    >
      <Bot className="h-4 w-4" />
      AI Advisor
    </Button>
  )
}
