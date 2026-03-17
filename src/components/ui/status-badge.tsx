import { Badge, type BadgeProps } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: string
}

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const statusMap: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
    // Success states
    COMPLETED: { variant: "success", label: "Completed" },
    CONNECTED: { variant: "success", label: "Connected" },

    // Info/Pending states
    PENDING: { variant: "secondary", label: "Pending" },
    VALIDATING: { variant: "secondary", label: "Validating" },

    // Warning/Active states
    RUNNING: { variant: "outline", label: "Running" },
    CONFIG_EXPORT: { variant: "outline", label: "Config Export" },
    INCIDENT_PULL: { variant: "outline", label: "Incident Pull" },
    ANALYZING: { variant: "outline", label: "Analyzing" },

    // Error states
    FAILED: { variant: "destructive", label: "Failed" },
    INVALID: { variant: "destructive", label: "Invalid" },
    DISCONNECTED: { variant: "destructive", label: "Disconnected" },

    // Cancelled state
    CANCELLED: { variant: "secondary", label: "Cancelled" },
  }

  const config = statusMap[status] || {
    variant: "secondary" as const,
    label: status,
  }

  return (
    <Badge variant={config.variant} className={cn("font-medium", className)} {...props}>
      {config.label}
    </Badge>
  )
}
