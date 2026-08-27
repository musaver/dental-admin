import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/schema";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";

export const authOptions: NextAuthOptions = {
  adapter: DrizzleAdapter(db),
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.log("Missing credentials");
          return null;
        }

        try {
          const [user_cred] = await db
            .select()
            .from(adminUsers)
            .where(eq(adminUsers.email, credentials.email))
            .limit(1);

          if (!user_cred) {
            console.log("User not found:", credentials.email);
            return null;
          }

          const isValid = await bcrypt.compare(credentials.password, user_cred.password ?? "");
          if (!isValid) {
            console.log("Invalid password for user:", credentials.email);
            return null;
          }

          console.log("User authenticated successfully:", credentials.email);
          return {
            id: user_cred.id,
            name: user_cred.name,
            email: user_cred.email,
          };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        console.log("JWT callback - setting token.id:", user.id);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as any).id = token.id;
        console.log("Session callback - setting session.user.id:", token.id);
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      console.log("Redirect callback:", { url, baseUrl });
      
      // Always redirect to main page (/) after login - which now contains the dashboard
      if (url === "/login" || url === `${baseUrl}/login`) {
        return `${baseUrl}/`;
      }
      
      // If coming from base URL, go to main page
      if (url === baseUrl) {
        return `${baseUrl}/`;
      }
      
      // Handle relative URLs
      if (url.startsWith("/")) {
        return `${baseUrl}${url}`;
      }
      
      // Handle absolute URLs that match the base domain
      if (new URL(url).origin === baseUrl) {
        return url;
      }
      
      // Default: redirect to main page
      return `${baseUrl}/`;
    },
  },
  debug: process.env.NODE_ENV === "development",
  logger: {
    error(code, metadata) {
      console.error("NextAuth Error:", code, metadata);
    },
    warn(code) {
      console.warn("NextAuth Warning:", code);
    },
    debug(code, metadata) {
      if (process.env.NODE_ENV === "development") {
        console.log("NextAuth Debug:", code, metadata);
      }
    },
  },
}; 