'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Film, Image as ImageIcon, Music, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Alert, EmptyState, Progress } from '@/components/ui/misc';
import { CommercialUseBadge, RightsBadge } from '@/components/domain/rights-badge';
import { formatDuration } from '@/lib/utils';

export interface AssetRow {
  id: string;
  name: string;
  kind: string;
  source: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  author: string | null;
  license: string | null;
  sourceUrl: string | null;
  commercialUse: string;
  rightsStatus: string | null;
  thumbnailUrl: string | null;
  url: string;
  notes: string;
}

const SOURCES = [
  { value: 'OWNED', label: 'OWNED — filmé par moi' },
  { value: 'LICENSED', label: 'LICENSED — sous licence' },
  { value: 'AI_GENERATED', label: 'AI_GENERATED — généré par IA' },
  { value: 'PUBLIC_DOMAIN', label: 'PUBLIC_DOMAIN — domaine public' },
  { value: 'EXTERNAL_REFERENCE', label: 'EXTERNAL_REFERENCE — référence' },
] as const;

const KIND_ICON = { VIDEO: Film, IMAGE: ImageIcon, AUDIO: Music } as const;

export function AssetsLibrary({ initialItems }: { initialItems: AssetRow[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<AssetRow | null>(null);
  const [pending, setPending] = useState(false);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return items
      .filter((a) => (kindFilter ? a.kind === kindFilter : true))
      .filter((a) => (sourceFilter ? a.source === sourceFilter : true))
      .filter((a) => (needle ? a.name.toLowerCase().includes(needle) : true));
  }, [items, filter, kindFilter, sourceFilter]);

  async function upload(files: FileList | File[]) {
    setError(null);
    setUploading(true);
    setProgress(0);

    const list = Array.from(files);
    for (const [index, file] of list.entries()) {
      const form = new FormData();
      form.append('file', file);
      form.append('source', 'OWNED');

      try {
        const response = await fetch('/api/assets/upload', { method: 'POST', body: form });
        const payload = (await response.json()) as { error?: string; remedy?: string };
        if (!response.ok) {
          setError([payload.error, payload.remedy].filter(Boolean).join('\n'));
          break;
        }
      } catch {
        setError('Upload impossible : le serveur est injoignable.');
        break;
      }
      setProgress(Math.round(((index + 1) / list.length) * 100));
    }

    setUploading(false);
    router.refresh();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
  }

  async function saveRights(asset: AssetRow, form: FormData) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/assets/${asset.id}/rights`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: String(form.get('owner') ?? ''),
          license: String(form.get('license') ?? ''),
          proofUrl: String(form.get('proofUrl') ?? ''),
          commercialUse: String(form.get('commercialUse') ?? 'UNKNOWN'),
          territory: String(form.get('territory') ?? 'WORLDWIDE'),
          restrictions: String(form.get('restrictions') ?? ''),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Enregistrement impossible.');
        return;
      }
      setSelected(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setPending(true);
    try {
      await fetch(`/api/assets/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((a) => a.id !== id));
      setSelected(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <Upload className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">Glissez vos fichiers ici</p>
        <p className="mt-1 text-xs text-muted-foreground">
          MP4, MOV, WebM, JPEG, PNG, WebP, MP3, WAV — 2 Go maximum par fichier
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp,audio/mpeg,audio/wav"
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          Parcourir
        </Button>
        {uploading ? (
          <div className="mx-auto mt-4 max-w-sm">
            <Progress value={progress} />
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert tone="danger">
          <pre className="whitespace-pre-wrap font-sans">{error}</pre>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Rechercher…"
          className="min-w-[200px] flex-1"
        />
        <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="w-auto">
          <option value="">Tous les types</option>
          <option value="VIDEO">Vidéo</option>
          <option value="IMAGE">Image</option>
          <option value="AUDIO">Audio</option>
        </Select>
        <Select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="w-auto"
        >
          <option value="">Toutes provenances</option>
          {SOURCES.map((s) => (
            <option key={s.value} value={s.value}>{s.value}</option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Aucun asset"
          description="Importez vos propres vidéos et photos. IAvid ne télécharge jamais de média depuis une plateforme sociale."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((asset) => {
            const Icon = KIND_ICON[asset.kind as keyof typeof KIND_ICON] ?? Film;
            return (
              <Card key={asset.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSelected(asset)}
                  className="block w-full text-left"
                >
                  {asset.thumbnailUrl ? (
                    <img src={asset.thumbnailUrl} alt="" className="h-40 w-full object-cover" />
                  ) : (
                    <div className="flex h-40 w-full items-center justify-center bg-muted">
                      <Icon className="size-8 text-muted-foreground" />
                    </div>
                  )}
                </button>
                <CardContent className="space-y-2 p-3">
                  <p className="truncate text-sm font-medium">{asset.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">{asset.source}</Badge>
                    {asset.durationMs ? (
                      <Badge variant="outline">{formatDuration(asset.durationMs)}</Badge>
                    ) : null}
                    {asset.width ? (
                      <Badge variant="outline">
                        {asset.width}×{asset.height}
                      </Badge>
                    ) : null}
                  </div>
                  <RightsBadge status={asset.rightsStatus as never} />
                  {asset.commercialUse === 'UNKNOWN' ? (
                    <CommercialUseBadge value="UNKNOWN" />
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelected(null)}
        >
          <Card
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle className="text-base">{selected.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selected.kind === 'VIDEO' ? (
                <video src={selected.url} controls className="max-h-72 w-full rounded bg-black" />
              ) : selected.kind === 'IMAGE' ? (
                <img src={selected.url} alt="" className="max-h-72 w-full rounded object-contain" />
              ) : (
                <audio src={selected.url} controls className="w-full" />
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveRights(selected, new FormData(e.currentTarget));
                }}
                className="space-y-3"
              >
                <h4 className="text-sm font-semibold">Gestion des droits</h4>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="owner">Propriétaire</Label>
                    <Input id="owner" name="owner" defaultValue={selected.author ?? ''} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="license">Licence</Label>
                    <Input
                      id="license"
                      name="license"
                      defaultValue={selected.license ?? ''}
                      placeholder="CC0, Pexels, contrat…"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="proofUrl">Preuve (URL)</Label>
                    <Input id="proofUrl" name="proofUrl" type="url" placeholder="https://…" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="territory">Territoire</Label>
                    <Input id="territory" name="territory" defaultValue="WORLDWIDE" />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="commercialUse">Usage commercial</Label>
                    <Select
                      id="commercialUse"
                      name="commercialUse"
                      defaultValue={selected.commercialUse}
                    >
                      <option value="UNKNOWN">UNKNOWN — inconnu (🟠 bloque la monétisation)</option>
                      <option value="ALLOWED">ALLOWED — autorisé</option>
                      <option value="DENIED">DENIED — interdit (🔴 bloque tout export)</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="restrictions">Restrictions</Label>
                    <Textarea id="restrictions" name="restrictions" className="min-h-[60px]" />
                  </div>
                </div>

                <Alert tone="info">
                  Un usage commercial <strong>ALLOWED</strong> sur un asset sous licence exige une
                  licence nommée <em>et</em> une preuve. Sans les deux, le statut reste 🟠.
                </Alert>

                <div className="flex gap-2">
                  <Button type="submit" disabled={pending}>
                    Enregistrer les droits
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setSelected(null)}>
                    Fermer
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    className="ml-auto"
                    onClick={() => remove(selected.id)}
                    disabled={pending}
                  >
                    <Trash2 />
                    Supprimer
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
