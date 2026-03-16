import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/server/db/client";

export async function POST(request: Request) {
  // Only allow dev login in development with explicit bypass flag
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS !== "true"
  ) {
    return new NextResponse(null, { status: 404 });
  }

  // Look up the seeded dev user so the JWT id matches the DB
  const devUser = await prisma.user.findUnique({
    where: { email: "dev@incident.io" },
  });

  const userId = devUser?.id ?? "dev-user-id";
  const userRole = devUser?.role ?? "ADMIN";

  // Create a NextAuth-compatible JWT token
  const payload = {
    sub: userId,
    email: "dev@incident.io",
    name: "Dev Admin",
    id: userId,
    role: userRole as "ADMIN" | "SA_SE" | "VIEWER",
  };

  // Use NextAuth's encode function to properly sign the JWT
  const token = await encode({
    token: payload,
    secret: process.env.NEXTAUTH_SECRET!,
    salt: "authjs.session-token",
  });

  // Set the session cookie
  const cookieStore = await cookies();
  cookieStore.set("authjs.session-token", token, {
    httpOnly: true,
    secure: false, // false for local dev (HTTP, not HTTPS)
    sameSite: "lax",
    maxAge: 24 * 60 * 60,
    path: "/",
  });

  return NextResponse.redirect(new URL("/", request.url));
}
