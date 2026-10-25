import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { dbFromEnv, getScanClaim, setSiteOwner } from '@/lib/db.js';
import { attachClaimedScans, loginRedirectTarget } from '@/lib/auth.js';

// Magic-link callback: exchange the code, attach any claim-cookie scans
// to the new session, then redirect to the requested page.
export async function GET(req) {
  const url = new URL(req.url);
  const next = loginRedirectTarget(url.searchParams.get('next'));
  const dest = new URL(next, req.url);
  const code = url.searchParams.get('code');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!code || !supabaseUrl || !supabaseKey) return NextResponse.redirect(dest);

  const cookieStore = await cookies();
  let response = NextResponse.redirect(dest);
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  await supabase.auth.exchangeCodeForSession(code);
  const { data } = await supabase.auth.getUser();
  if (data?.user) {
    const db = dbFromEnv();
    if (db) {
      const pairs = cookieStore.getAll().map((c) => [c.name, c.value]);
      await attachClaimedScans(db, data.user.id, pairs, { getScanClaim, setSiteOwner });
    }
  }
  return response;
}
