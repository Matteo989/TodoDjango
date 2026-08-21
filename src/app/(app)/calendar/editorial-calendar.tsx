'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import { CalendarPlus, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

interface PublicationRow {
  id: string;
  videoId: string;
  videoTitle: string;
  platform: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  handle: string | null;
  manualReason: string | null;
  caption: string;
  hashtags: string[];
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  DRAFT: 'secondary',
  READY: 'default',
  SCHEDULED: 'default',
  PUBLISHED: 'success',
  FAILED: 'destructive',
  MANUAL_REQUIRED: 'warning',
};

type ViewMode = 'day' | 'week' | 'month';

export function EditorialCalendar({
  publications,
  videos,
  accounts,
}: {
  publications: PublicationRow[];
  videos: Array<{ id: string; title: string }>;
  accounts: Array<{ id: string; platform: string; handle: string }>;
}) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [manual, setManual] = useState<Record<string, unknown> | null>(null);

  const days = useMemo(() => {
    if (view === 'day') return [cursor];
    if (view === 'week') {
      return eachDayOfInterval({
        start: startOfWeek(cursor, { weekStartsOn: 1 }),
        end: endOfWeek(cursor, { weekStartsOn: 1 }),
      });
    }
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
    });
  }, [view, cursor]);

  function shift(direction: 1 | -1) {
    if (view === 'day') setCursor((c) => addDays(c, direction));
    else if (view === 'week') setCursor((c) => addDays(c, direction * 7));
    else setCursor((c) => addMonths(c, direction));
  }

  function publicationsOn(day: Date) {
    return publications.filter((p) => {
      const when = p.scheduledAt ?? p.publishedAt;
      return when ? isSameDay(new Date(when), day) : false;
    });
  }

  async function schedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const videoId = String(form.get('videoId'));

    try {
      const response = await fetch(`/api/videos/${videoId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'schedule',
          platform: String(form.get('platform')),
          socialAccountId: String(form.get('socialAccountId') || '') || undefined,
          scheduledAt: new Date(
            `${String(form.get('date'))}T${String(form.get('time'))}:00`,
          ).toISOString(),
          caption: String(form.get('caption') || ''),
          hashtags: String(form.get('hashtags') || '')
            .split(/[\s,]+/)
            .map((h) => h.replace(/^#/, ''))
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Programmation impossible.');
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function openManualExport(publication: PublicationRow) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${publication.videoId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'manual', publicationId: publication.id }),
      });
      const payload = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Export impossible.');
        return;
      }
      setManual(payload);
    } finally {
      setPending(false);
    }
  }

  async function publish(publication: PublicationRow) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/videos/${publication.videoId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', publicationId: publication.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Publication impossible.');
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <div className="space-y-4 lg:col-span-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base capitalize">
              {format(cursor, view === 'day' ? 'EEEE d MMMM yyyy' : 'MMMM yyyy', { locale: fr })}
            </CardTitle>
            <div className="flex items-center gap-1">
              {(['day', 'week', 'month'] as const).map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={view === mode ? 'secondary' : 'ghost'}
                  onClick={() => setView(mode)}
                >
                  {mode === 'day' ? 'Jour' : mode === 'week' ? 'Semaine' : 'Mois'}
                </Button>
              ))}
              <Button size="sm" variant="outline" onClick={() => shift(-1)}>
                <ChevronLeft />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>
                Auj.
              </Button>
              <Button size="sm" variant="outline" onClick={() => shift(1)}>
                <ChevronRight />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {view === 'month' ? (
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
                {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((label) => (
                  <div
                    key={label}
                    className="bg-muted/60 px-2 py-1.5 text-center text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </div>
                ))}
                {days.map((day) => {
                  const entries = publicationsOn(day);
                  return (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        'min-h-[92px] bg-card p-1.5',
                        !isSameMonth(day, cursor) && 'opacity-40',
                        isSameDay(day, new Date()) && 'ring-1 ring-inset ring-primary',
                      )}
                    >
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {format(day, 'd')}
                      </p>
                      <div className="space-y-1">
                        {entries.slice(0, 3).map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => openManualExport(entry)}
                            className="block w-full truncate rounded bg-primary/10 px-1.5 py-0.5 text-left text-[10px] hover:bg-primary/20"
                            title={entry.videoTitle}
                          >
                            {entry.platform.split('_')[0]} · {entry.videoTitle}
                          </button>
                        ))}
                        {entries.length > 3 ? (
                          <p className="text-[10px] text-muted-foreground">
                            +{entries.length - 3}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {days.map((day) => {
                  const entries = publicationsOn(day);
                  return (
                    <div key={day.toISOString()} className="rounded-lg border p-3">
                      <p className="mb-2 text-sm font-medium capitalize">
                        {format(day, 'EEEE d MMMM', { locale: fr })}
                      </p>
                      {entries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Rien de programmé.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {entries.map((entry) => (
                            <li
                              key={entry.id}
                              className="flex flex-wrap items-center gap-2 rounded border px-2.5 py-2"
                            >
                              <Badge variant={STATUS_VARIANT[entry.status] ?? 'secondary'}>
                                {entry.status}
                              </Badge>
                              <Badge variant="outline">{entry.platform}</Badge>
                              <Link
                                href={`/videos/${entry.videoId}`}
                                className="min-w-0 flex-1 truncate text-sm hover:underline"
                              >
                                {entry.videoTitle}
                              </Link>
                              {entry.scheduledAt ? (
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(entry.scheduledAt), 'HH:mm')}
                                </span>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openManualExport(entry)}
                                disabled={pending}
                              >
                                <Download />
                              </Button>
                              {entry.status !== 'PUBLISHED' ? (
                                <Button size="sm" onClick={() => publish(entry)} disabled={pending}>
                                  Publier
                                </Button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {manual ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publication manuelle requise</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert tone="warning">{String(manual['notes'] ?? '')}</Alert>
              <div className="space-y-2 text-sm">
                <CopyRow label="Titre" value={String(manual['title'] ?? '')} />
                <CopyRow label="Description" value={String(manual['description'] ?? '')} />
                <CopyRow label="Hashtags" value={String(manual['hashtags'] ?? '')} />
                {manual['cta'] ? <CopyRow label="CTA" value={String(manual['cta'])} /> : null}
              </div>
              <div className="flex gap-2">
                <Button asChild>
                  <a href={String(manual['downloadUrl'] ?? '')} download={String(manual['filename'] ?? '')}>
                    <Download />
                    Télécharger le fichier
                  </a>
                </Button>
                <Button variant="outline" onClick={() => setManual(null)}>Fermer</Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Programmer</CardTitle>
        </CardHeader>
        <CardContent>
          {videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune vidéo prête. Terminez un montage d&apos;abord.
            </p>
          ) : (
            <form onSubmit={schedule} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="videoId">Vidéo</Label>
                <Select id="videoId" name="videoId" required>
                  {videos.map((video) => (
                    <option key={video.id} value={video.id}>{video.title}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="platform">Plateforme</Label>
                <Select id="platform" name="platform" defaultValue="TIKTOK">
                  <option value="TIKTOK">TikTok</option>
                  <option value="YOUTUBE_SHORTS">YouTube Shorts</option>
                  <option value="INSTAGRAM_REELS">Instagram Reels</option>
                  <option value="SNAPCHAT_SPOTLIGHT">Snapchat Spotlight</option>
                </Select>
              </div>
              {accounts.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="socialAccountId">Compte</Label>
                  <Select id="socialAccountId" name="socialAccountId">
                    <option value="">—</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.handle} ({account.platform})
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    name="date"
                    type="date"
                    required
                    defaultValue={format(new Date(), 'yyyy-MM-dd')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="time">Heure</Label>
                  <Input id="time" name="time" type="time" required defaultValue="18:00" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="caption">Légende</Label>
                <Textarea id="caption" name="caption" className="min-h-[70px]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hashtags">Hashtags</Label>
                <Input id="hashtags" name="hashtags" placeholder="bricolage diy astucemaison" />
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                <CalendarPlus />
                Programmer
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void navigator.clipboard.writeText(value)}
        >
          Copier
        </Button>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{value || '—'}</p>
    </div>
  );
}
