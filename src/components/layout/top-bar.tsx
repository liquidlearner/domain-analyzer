"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useState } from "react"

interface TopBarProps {
  user: {
    name: string
    email: string
    role: string
    image?: string
  }
  onMenuToggle: () => void
  onSignOut: () => Promise<void>
}

export function TopBar({ user, onMenuToggle, onSignOut }: TopBarProps) {
  const [isSignOutOpen, setIsSignOutOpen] = useState(false)

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "ADMIN":
        return "default"
      case "SA_SE":
        return "secondary"
      default:
        return "outline"
    }
  }

  const handleSignOut = async () => {
    await onSignOut()
  }

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-20 border-b border-zinc-200 bg-white">
        <div className="flex h-16 items-center justify-between px-4 md:px-6">
          {/* Left side - Menu button (mobile), breadcrumb placeholder */}
          <div className="flex items-center gap-4">
            <div className="hidden md:block text-sm text-zinc-600">
              Dashboard
            </div>
          </div>

          {/* Right side - User info and sign out */}
          <div className="flex items-center gap-4">
            <Badge variant={getRoleBadgeVariant(user.role)} className="text-xs">
              {user.role}
            </Badge>

            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                {user.image && <AvatarImage src={user.image} alt={user.name} />}
                <AvatarFallback className="bg-zinc-200 text-zinc-900 text-xs font-semibold">
                  {user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)}
                </AvatarFallback>
              </Avatar>

              <div className="hidden sm:block">
                <p className="text-sm font-medium text-zinc-900">{user.name}</p>
                <p className="text-xs text-zinc-500">{user.email}</p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsSignOutOpen(true)}
                className="text-xs"
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Sign out confirmation dialog */}
      <Dialog open={isSignOutOpen} onOpenChange={setIsSignOutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign Out</DialogTitle>
            <DialogDescription>
              Are you sure you want to sign out?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setIsSignOutOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSignOut}
            >
              Sign Out
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
