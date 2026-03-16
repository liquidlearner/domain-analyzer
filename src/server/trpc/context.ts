import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { auth } from "@/lib/auth";
import { prisma } from "@/server/db/client";

export async function createContext(opts?: FetchCreateContextFnOptions) {
  const session = await auth();

  return {
    session,
    user: session?.user
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role as "ADMIN" | "SA_SE" | "VIEWER",
        }
      : null,
    prisma,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
