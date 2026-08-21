'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';

/**
 * Saisie manuelle des performances.
 *
 * C'est le mode nominal tant qu'aucune API de plateforme n'est connectée:
 * mieux vaut des chiffres saisis, dont l'origine est connue, que des chiffres
 * inventés par l'application.
 */
export function AnalyticsEntry({
  videos,
}: {
  videos: Array<{ id: string; title: string; renderedDurationMs: number | null }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: String(form.get('videoId')),
          platform: String(form.get('platform')),
          measuredOn: new Date(String(form.get('measuredOn'))).toISOString(),
          views: Number(form.get('views')),
          likes: Number(form.get('likes')),
          comments: Number(form.get('comments')),
          shares: Number(form.get('shares')),
          followersGained: Number(form.get('followersGained')),
          avgWatchMs: Math.round(Number(form.get('avgWatchSec')) * 1000),
          revenueCents: Math.round(Number(form.get('revenue')) * 100),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Enregistrement impossible.');
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saisir une mesure</CardTitle>
      </CardHeader>
      <CardContent>
        {videos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune vidéo à mesurer pour l&apos;instant.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {saved ? <Alert tone="success">Mesure enregistrée.</Alert> : null}

            <div className="space-y-1.5">
              <Label htmlFor="videoId">Vidéo</Label>
              <Select id="videoId" name="videoId" required>
                {videos.map((video) => (
                  <option key={video.id} value={video.id}>{video.title}</option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="platform">Plateforme</Label>
                <Select id="platform" name="platform" defaultValue="TIKTOK">
                  <option value="TIKTOK">TikTok</option>
                  <option value="YOUTUBE_SHORTS">YouTube Shorts</option>
                  <option value="INSTAGRAM_REELS">Instagram Reels</option>
                  <option value="SNAPCHAT_SPOTLIGHT">Snapchat</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="measuredOn">Date</Label>
                <Input
                  id="measuredOn"
                  name="measuredOn"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <Field id="views" label="Vues" />
              <Field id="likes" label="Likes" />
              <Field id="comments" label="Commentaires" />
              <Field id="shares" label="Partages" />
              <Field id="followersGained" label="Abonnés gagnés" />
              <Field id="avgWatchSec" label="Visionnage moyen (s)" step="0.1" />
              <Field id="revenue" label="Revenu (€)" step="0.01" />
            </div>

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Le CONTENT_SCORE et les taux de complétion et d&apos;engagement sont calculés
              automatiquement à partir de ces valeurs.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ id, label, step }: { id: string; label: string; step?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} name={id} type="number" min={0} step={step ?? '1'} defaultValue={0} />
    </div>
  );
}
