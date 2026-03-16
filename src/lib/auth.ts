import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/server/db/client";

declare module "next-auth" {
  interface User {
    id: string;
    role: "ADMIN" | "SA_SE" | "VIEWER";
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string;
      image?: string;
      role: "ADMIN" | "SA_SE" | "VIEWER";
    };
  }
}



export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    ...(process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true"
      ? [
          Credentials({
            name: "Dev Login",
            credentials: {},
            async authorize() {
              return {
                id: "dev-user-id",
                email: "dev@incident.io",
                name: "Dev Admin",
                role: "ADMIN" as const,
              };
            },
          }),
        ]
      : []),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      // In dev mode, allow all emails. In production, restrict to @incident.io
      if (process.env.NODE_ENV === "development") {
        return true;
      }

      if (!user.email) {
        return false;
      }

      const isIncidentIoDomain = user.email.endsWith("@incident.io");
      if (!isIncidentIoDomain) {
        return false;
      }

      return true;
    },
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      } else {
        // Look up user in database by email
        const email = typeof token.email === "string" ? token.email : "";
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email },
          });

          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role as "ADMIN" | "SA_SE" | "VIEWER";
          } else {
            // Default role for new users
            token.role = "VIEWER";
            token.id = "";
          }
        } catch (error) {
          // If database is unreachable, fall back to token data
          console.error("Failed to lookup user in database:", error);
          token.role = token.role || "VIEWER";
          token.id = token.id || "";
        }
      }

      return token;
    },
    async session({ session, token }: any) {
      if (session.user) {
        session.user.id = (token.id as string) || "";
        session.user.role = (token.role as "ADMIN" | "SA_SE" | "VIEWER") || "VIEWER";
      }
      return session;
    },
  },
});
