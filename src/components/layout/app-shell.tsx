"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"
import { TopBar } from "./top-bar"

interface AppShellProps {
  children: React.ReactNode
  user: {
    name: string
    email: string
    role: string
    image?: string
  }
  onSignOut: () => Promise<void>
}

export function AppShell({ children, user, onSignOut }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen bg-zinc-50">
      {/* Sidebar */}
      <Sidebar user={user} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <TopBar user={user} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} onSignOut={onSignOut} />

        {/* Main content */}
        <main className="flex-1 overflow-y-auto pt-20 md:pt-16 md:pl-64">
          <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
