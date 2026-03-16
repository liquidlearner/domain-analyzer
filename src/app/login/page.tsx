"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const isDev =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true";

  const handleGoogleSignIn = async () => {
    await signIn("google", { redirectTo: "/" });
  };

  const handleDevLogin = async () => {
    const response = await fetch("/api/auth/dev-login", {
      method: "POST",
      redirect: "follow",
    });

    if (response.redirected) {
      window.location.href = response.url;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-full max-w-md space-y-8 rounded-lg bg-white p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-900">
            PD Migration Analyzer
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Analyze and manage incident.io domain migrations
          </p>
        </div>

        <div className="space-y-4">
          <Button
            onClick={handleGoogleSignIn}
            className="w-full"
            size="lg"
            variant="default"
          >
            Sign in with Google
          </Button>

          {isDev && (
            <Button
              onClick={handleDevLogin}
              className="w-full"
              size="lg"
              variant="outline"
            >
              Dev Login
            </Button>
          )}
        </div>

        <p className="text-center text-xs text-slate-500">
          Only incident.io email accounts can sign in
        </p>
      </div>
    </div>
  );
}
