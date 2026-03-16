import { auth, signOut } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { redirect } from "next/navigation";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  async function handleSignOut() {
    "use server";
    await signOut();
  }

  return (
    <AppShell
      user={{
        name: session.user?.name || "User",
        email: session.user?.email || "",
        role: session.user?.role || "VIEWER",
        image: session.user?.image,
      }}
      onSignOut={handleSignOut}
    >
      {children}
    </AppShell>
  );
}
