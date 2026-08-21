'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Coins,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  Package,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  { href: '/research', label: 'Research', icon: TrendingUp },
  { href: '/scripts', label: 'Scripts', icon: ScrollText },
  { href: '/assets', label: 'Assets', icon: FolderOpen },
  { href: '/videos', label: 'Videos', icon: Video },
  { href: '/templates', label: 'Templates', icon: FileText },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/rights', label: 'Rights', icon: ShieldCheck },
  { href: '/costs', label: 'AI Costs', icon: Coins },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

export function AppShell({
  children,
  userName,
  workspaceName,
  runningJobs,
}: {
  children: React.ReactNode;
  userName: string;
  workspaceName: string;
  runningJobs: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-card transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center border-b px-5">
          <Link href="/dashboard" className="text-xl font-bold tracking-tight">
            IA<span className="text-primary">vid</span>
          </Link>
        </div>

        <div className="px-3 py-4">
          <Button asChild className="w-full" size="lg">
            <Link href="/create">
              <Sparkles />
              CREATE VIDEO
            </Link>
          </Button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">{workspaceName}</p>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={logout}>
            <LogOut />
            Déconnexion
          </Button>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b bg-background px-4 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
          >
            <Menu />
          </Button>
          <div className="flex-1" />
          {runningJobs > 0 ? (
            <Link href="/videos">
              <Badge variant="default">
                <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-primary" />
                {runningJobs} job{runningJobs > 1 ? 's' : ''} en cours
              </Badge>
            </Link>
          ) : null}
        </header>

        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
