// Server-only Supabase client (reads the session from cookies).
// Imported by server components and route handlers, never by the browser.
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { authConfigured } from './supabase-browser.js';

export async function serverClient() {
  if (!authConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; the proxy refreshes the session.
        }
      },
    },
  });
}

export async function sessionUser() {
  try {
    const client = await serverClient();
    if (!client) return null;
    const { data } = await client.auth.getUser();
    return data?.user || null;
  } catch {
    return null;
  }
}
