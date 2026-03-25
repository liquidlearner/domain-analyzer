"use client"

import { FileText, Users, AlertTriangle, BookOpen, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { QuickActionType } from '@/server/services/ai/prompts'

interface QuickActionsProps {
  onAction: (action: QuickActionType) => void
  disabled?: boolean
}

const ACTIONS: { type: QuickActionType; label: string; icon: typeof FileText }[] = [
  { type: 'executive_summary', label: 'Executive Summary', icon: FileText },
  { type: 'team_breakdown', label: 'Team Breakdown', icon: Users },
  { type: 'risk_brief', label: 'Risk Brief', icon: AlertTriangle },
  { type: 'migration_runbook', label: 'Migration Runbook', icon: BookOpen },
  { type: 'stakeholder_email', label: 'Stakeholder Email', icon: Mail },
]

export function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {ACTIONS.map(({ type, label, icon: Icon }) => (
        <Button
          key={type}
          variant="outline"
          size="sm"
          onClick={() => onAction(type)}
          disabled={disabled}
          className="text-xs"
        >
          <Icon className="h-3.5 w-3.5 mr-1.5" />
          {label}
        </Button>
      ))}
    </div>
  )
}
