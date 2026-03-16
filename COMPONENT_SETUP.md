# shadcn/ui Component Library Setup

All shadcn/ui-style utility files and components have been successfully created for this Next.js 14+ App Router project.

## Created Files

### Utilities
- **src/lib/utils.ts** - Core `cn()` utility function combining clsx and tailwind-merge

### UI Components
1. **src/components/ui/button.tsx**
   - Variants: default, destructive, outline, secondary, ghost, link
   - Sizes: default, sm, lg, icon
   - Uses class-variance-authority and Radix Slot for asChild support

2. **src/components/ui/card.tsx**
   - Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
   - Simple div-based components with proper Tailwind styling

3. **src/components/ui/badge.tsx**
   - Variants: default, secondary, destructive, outline, success, warning, info
   - Inline flex components with customizable styling

4. **src/components/ui/input.tsx**
   - Standard HTML input wrapper with Tailwind styling
   - Focus states and accessibility support

5. **src/components/ui/label.tsx**
   - Built on @radix-ui/react-label
   - Proper accessibility and styling

6. **src/components/ui/tabs.tsx**
   - Tabs, TabsList, TabsTrigger, TabsContent
   - Built on @radix-ui/react-tabs
   - Animated states and proper active styling

7. **src/components/ui/table.tsx**
   - Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption
   - Semantic HTML with proper Tailwind styling
   - Hover states and selection support

8. **src/components/ui/select.tsx**
   - Select, SelectTrigger, SelectValue, SelectContent, SelectItem
   - SelectLabel, SelectGroup, SelectSeparator
   - Built on @radix-ui/react-select with lucide-react icons
   - Scroll buttons for long lists

9. **src/components/ui/dialog.tsx**
   - Dialog, DialogTrigger, DialogPortal, DialogClose
   - DialogOverlay, DialogContent, DialogHeader, DialogFooter
   - DialogTitle, DialogDescription
   - Built on @radix-ui/react-dialog with animations

10. **src/components/ui/toast.tsx**
    - Toast, ToastAction, ToastClose, ToastTitle, ToastDescription
    - ToastProvider, ToastViewport
    - Built on @radix-ui/react-toast with variants

11. **src/components/ui/toaster.tsx**
    - Toaster component for rendering toast notifications
    - Integrates with useToast hook

12. **src/components/ui/avatar.tsx**
    - Avatar, AvatarImage, AvatarFallback
    - Built on @radix-ui/react-avatar

13. **src/components/ui/separator.tsx**
    - Separator component for visual dividers
    - Built on @radix-ui/react-separator
    - Supports horizontal and vertical orientation

14. **src/components/ui/progress.tsx**
    - Progress bar component (div-based, not Radix)
    - Accepts value prop (0-100) and animates fill bar

### Hooks
- **src/hooks/use-toast.ts** - Toast notification hook with state management

## Features

All components include:
- "use client" directive where needed for interactivity
- Proper TypeScript types with React.forwardRef
- Named exports
- Tailwind CSS classes with zinc neutral/dark theme
- Full dark mode support
- Accessibility features (ARIA, focus states)
- Animation support for interactive components

## Dependencies Required

The following packages should be installed (likely already present):
- `react` and `react-dom`
- `next`
- `clsx`
- `tailwind-merge`
- `class-variance-authority`
- `@radix-ui/react-label`
- `@radix-ui/react-tabs`
- `@radix-ui/react-select`
- `@radix-ui/react-dialog`
- `@radix-ui/react-toast`
- `@radix-ui/react-avatar`
- `@radix-ui/react-separator`
- `@radix-ui/react-slot`
- `lucide-react` (for icons in select, dialog, toast)

## Usage Example

```tsx
"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

export function ExampleComponent() {
  const { toast } = useToast()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Example Form</CardTitle>
        <CardDescription>Fill out the form below</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="input">Input Field</Label>
            <Input id="input" placeholder="Enter text..." />
          </div>
          <Button onClick={() => toast({
            title: "Success!",
            description: "Form submitted successfully."
          })}>
            Submit
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
```

## Toaster Setup

To use the toast system, add the Toaster component to your root layout:

```tsx
// app/layout.tsx
import { Toaster } from "@/components/ui/toaster"

export default function RootLayout() {
  return (
    <html>
      <body>
        {/* Your content */}
        <Toaster />
      </body>
    </html>
  )
}
```

All components are production-ready and follow shadcn/ui conventions.
