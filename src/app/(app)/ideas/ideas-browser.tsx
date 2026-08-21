'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Archive, Copy, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import { formatCents } from '@/lib/utils';

export interface IdeaRow {
  id: string;
  title: string;
  description: string;
  hook: string | null;
  category: string;
  subcategory: string | null;
  difficulty: string;
  status: string;
  estimatedCostCents: number;
  targetDurationSec: number;
  viralScore: number;
  originalityScore: number;
  productionScore: number;
  affiliateScore: number;
  safetyScore: number;
  notes: string;
  scriptCount: number;
  videoCount: number;
  createdAt: string;
}

const STATUSES = [
  'IDEA', 'RESEARCH', 'SCRIPT', 'ASSETS', 'VOICE', 'EDITING',
  'REVIEW', 'READY', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED',
] as const;

const SORTS = {
  recent: (a: IdeaRow, b: IdeaRow) => b.createdAt.localeCompare(a.createdAt),
  viral: (a: IdeaRow, b: IdeaRow) => b.viralScore - a.viralScore,
  originality: (a: IdeaRow, b: IdeaRow) => b.originalityScore - a.originalityScore,
  production: (a: IdeaRow, b: IdeaRow) => b.productionScore - a.productionScore,
  title: (a: IdeaRow, b: IdeaRow) => a.title.localeCompare(b.title),
} as const;

export function IdeasBrowser({ initialItems }: { initialItems: IdeaRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [sort, setSort] = useState<keyof typeof SORTS>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((idea) => (showArchived ? true : idea.status !== 'ARCHIVED'))
      .filter((idea) => (status ? idea.status === status : true))
      .filter((idea) => (difficulty ? idea.difficulty === difficulty : true))
      .filter((idea) =>
        needle
          ? [idea.title, idea.description, idea.hook, idea.subcategory]
              .filter(Boolean)
              .some((field) => field!.toLowerCase().includes(needle))
          : true,
      )
      .sort(SORTS[sort]);
  }, [items, search, status, difficulty, sort, showArchived]);

  async function act(id: string, action: 'duplicate' | 'archive') {
    setPending(id);
    try {
      const response = await fetch(`/api/ideas/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) return;

      if (action === 'archive') {
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'ARCHIVED' } : i)));
      } else {
        router.refresh();
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une idée…"
            className="pl-9"
          />
        </div>

        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">Tous les statuts</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>

        <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-auto">
          <option value="">Toutes difficultés</option>
          {['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>

        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as keyof typeof SORTS)}
          className="w-auto"
        >
          <option value="recent">Plus récentes</option>
          <option value="viral">Score viral</option>
          <option value="originality">Originalité</option>
          <option value="production">Faisabilité</option>
          <option value="title">Titre</option>
        </Select>

        <Button
          variant={showArchived ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowArchived((v) => !v)}
        >
          <Archive />
          Archivées
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Aucune idée"
          description="Générez un lot d'idées ou créez-en une manuellement."
          action={
            <Button asChild>
              <Link href="/ideas/generate">Generate Ideas</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((idea) => (
            <Card key={idea.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/ideas/${idea.id}`}
                    className="text-sm font-semibold leading-snug hover:underline"
                  >
                    {idea.title}
                  </Link>
                  <Badge variant={idea.status === 'ARCHIVED' ? 'muted' : 'secondary'}>
                    {idea.status}
                  </Badge>
                </div>

                {idea.hook ? (
                  <p className="line-clamp-2 text-xs italic text-muted-foreground">« {idea.hook} »</p>
                ) : null}

                {idea.notes.startsWith('⚠️') ? (
                  <p className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-xs">
                    {idea.notes.split('\n')[0]}
                  </p>
                ) : null}

                <div className="grid grid-cols-5 gap-1 text-center">
                  {[
                    { label: 'VIRAL', value: idea.viralScore },
                    { label: 'ORIG', value: idea.originalityScore },
                    { label: 'PROD', value: idea.productionScore },
                    { label: 'AFF', value: idea.affiliateScore },
                    { label: 'SAFE', value: idea.safetyScore },
                  ].map((score) => (
                    <div key={score.label} className="rounded bg-muted/60 px-1 py-1.5">
                      <p className="text-[9px] font-medium text-muted-foreground">{score.label}</p>
                      <p className="text-sm font-semibold tabular-nums">{score.value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline">{idea.difficulty}</Badge>
                  <Badge variant="outline">{idea.targetDurationSec}s</Badge>
                  <Badge variant="outline">{formatCents(idea.estimatedCostCents)}</Badge>
                  {idea.scriptCount > 0 ? (
                    <Badge variant="muted">{idea.scriptCount} script(s)</Badge>
                  ) : null}
                </div>

                <div className="mt-auto flex gap-1.5 pt-2">
                  <Button asChild size="sm" className="flex-1">
                    <Link href={`/ideas/${idea.id}`}>Ouvrir</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act(idea.id, 'duplicate')}
                    disabled={pending === idea.id}
                    title="Dupliquer"
                  >
                    <Copy />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act(idea.id, 'archive')}
                    disabled={pending === idea.id || idea.status === 'ARCHIVED'}
                    title="Archiver"
                  >
                    <Archive />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
