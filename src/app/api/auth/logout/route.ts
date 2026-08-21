import { clearSessionCookie } from '@/server/auth/session';
import { ok } from '@/lib/api';

export async function POST() {
  await clearSessionCookie();
  return ok({ success: true });
}
