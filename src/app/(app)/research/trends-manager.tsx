'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Alert, EmptyState } from '@/components/ui/misc';

interface TrendRow {
  id: string;
  kind: string;
  value: string;
  platform: string | null;
  weight: number;
  season: string | null;
  source: string;
}

const KINDS = [
  { value: 'TOPIC', label: 'Sujet' },
  { value: 'KEYWORD', label: 'Mot-clé' },
  { value: 'HASHTAG', label: 'Hashtag' },
  { value: 'TITLE', label: 'Titre populaire' },
  { value: 'FORMAT', label: 'Format' },
  { value: 'QUESTION', label: 'Question fréquente' },
  { value: 'SEASONAL', label: 'Saisonnier' },
] as const;

export function TrendsManager({ initialItems }: { initialItems: TrendRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [bulk, setBulk] = useState('');

  async function addOne(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit([
      {
        kind: String(form.get('kind')),
        value: String(form.get('value')),
        weight: Number(form.get('weight')),
        season: String(form.get('season') || '') || undefined,
      },
    ]);
    event.currentTarget.reset();
  }

  /** Import en masse: une entrée par ligne, format `TYPE | valeur | poids`. */
  async function addBulk() {
    const parsed = bulk
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [kind, value, weight] = line.split('|').map((p) => p.trim());
        return {
          kind: (kind ?? 'TOPIC').toUpperCase(),
          value: value ?? '',
          weight: Number(weight ?? 50) || 50,
        };
      })
      .filter((item) => item.value.length > 0 && KINDS.some((k) => k.value === item.kind));

    if (parsed.length === 0) {
      setError('Aucune ligne exploitable. Format attendu : TYPE | valeur | poids');
      return;
    }
    await submit(parsed);
    setBulk('');
  }

  async function submit(payload: unknown[]) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? 'Enregistrement impossible.');
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setPending(true);
    try {
      await fetch(`/api/trends?id=${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((t) => t.id !== id));
    } finally {
      setPending(false);
    }
  }

  const grouped = KINDS.map((kind) => ({
    ...kind,
    entries: items.filter((item) => item.kind === kind.value),
  })).filter((group) => group.entries.length > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {grouped.length === 0 ? (
          <EmptyState
            title="Aucune tendance"
            description="Ajoutez ce que vous observez : sujets, mots-clés, hashtags, formats, questions récurrentes."
          />
        ) : (
          grouped.map((group) => (
            <Card key={group.value}>
              <CardHeader>
                <CardTitle className="text-base">
                  {group.label}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {group.entries.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {group.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-3 rounded border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {group.value === 'HASHTAG' ? `#${entry.value}` : entry.value}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        {entry.season ? <Badge variant="outline">{entry.season}</Badge> : null}
                        <Badge variant="muted">{entry.weight}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(entry.id)}
                          disabled={pending}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ajouter une tendance</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addOne} className="space-y-3">
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <div className="space-y-1.5">
                <Label htmlFor="kind">Type</Label>
                <Select id="kind" name="kind" defaultValue="TOPIC">
                  {KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>{kind.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="value">Valeur</Label>
                <Input id="value" name="value" required maxLength={300} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="weight">Poids (0–100)</Label>
                  <Input
                    id="weight"
                    name="weight"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={50}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="season">Saison</Label>
                  <Input id="season" name="season" placeholder="hiver…" />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                <Plus />
                Ajouter
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import en masse</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={'TOPIC | Rénovation petit budget | 90\nHASHTAG | bricolage | 85\nQUESTION | Quel enduit choisir ? | 60'}
              className="min-h-[140px] font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Une entrée par ligne : <code>TYPE | valeur | poids</code>
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={addBulk}
              disabled={pending || !bulk.trim()}
            >
              Importer
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
