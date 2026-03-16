import { LucideIcon } from "lucide-react"
import { ReactNode } from "react"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex min-h-96 flex-col items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-12 text-center">
      {Icon && (
        <Icon className="mb-4 h-12 w-12 text-zinc-400" strokeWidth={1.5} />
      )}
      <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
      <p className="mt-2 text-sm text-zinc-600">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
