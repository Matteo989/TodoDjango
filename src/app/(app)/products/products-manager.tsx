'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { LinkIcon, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Alert, EmptyState } from '@/components/ui/misc';
import { formatCents } from '@/lib/utils';

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  url: string;
  priceCents: number;
  category: string | null;
  commissionRate: number;
  platform: string | null;
  status: string;
  clicks: number;
  conversions: number;
  revenueCents: number;
  epcCents: number | null;
  links: Array<{
    id: string;
    affiliateUrl: string;
    utmCampaign: string | null;
    clicks: number;
    conversions: number;
    revenueCents: number;
    videoTitle: string | null;
  }>;
}

export function ProductsManager({
  products,
  videos,
}: {
  products: ProductRow[];
  videos: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const target = event.currentTarget;

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name')),
          brand: String(form.get('brand') || '') || undefined,
          url: String(form.get('url')),
          priceCents: Math.round(Number(form.get('price')) * 100),
          category: String(form.get('category') || '') || undefined,
          commissionRate: Number(form.get('commissionRate')),
          platform: String(form.get('platform') || '') || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Création impossible.');
        return;
      }
      target.reset();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function createLink(productId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/products/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          videoId: String(form.get('videoId') || '') || undefined,
          affiliateUrl: String(form.get('affiliateUrl')),
          utmSource: String(form.get('utmSource') || '') || undefined,
          utmMedium: 'social',
          utmCampaign: String(form.get('utmCampaign') || '') || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Création impossible.');
        return;
      }
      setLinkFor(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function updateMetrics(linkId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      await fetch('/api/products/links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          linkId,
          clicks: Number(form.get('clicks')),
          conversions: Number(form.get('conversions')),
          revenueCents: Math.round(Number(form.get('revenue')) * 100),
        }),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {products.length === 0 ? (
          <EmptyState
            title="Aucun produit"
            description="Ajoutez les produits que vous recommandez, puis rattachez-leur vos liens d'affiliation."
          />
        ) : (
          products.map((product) => (
            <Card key={product.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{product.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {[product.brand, product.category, product.platform].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Badge variant={product.status === 'ACTIVE' ? 'success' : 'secondary'}>
                  {product.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Metric label="Prix" value={formatCents(product.priceCents)} />
                  <Metric label="Commission" value={`${product.commissionRate}%`} />
                  <Metric label="Clics" value={String(product.clicks)} />
                  <Metric label="Conversions" value={String(product.conversions)} />
                  <Metric
                    label="EPC"
                    value={product.epcCents === null ? '—' : formatCents(product.epcCents)}
                  />
                </div>

                {product.links.length > 0 ? (
                  <ul className="space-y-2 border-t pt-3">
                    {product.links.map((link) => (
                      <li key={link.id} className="rounded border p-2.5">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {link.videoTitle ?? 'Sans vidéo'}
                            {link.utmCampaign ? ` · ${link.utmCampaign}` : ''}
                          </span>
                          <Badge variant="muted">{formatCents(link.revenueCents)}</Badge>
                        </div>
                        <form
                          onSubmit={(e) => updateMetrics(link.id, e)}
                          className="flex flex-wrap items-end gap-2"
                        >
                          <SmallField id={`clicks-${link.id}`} name="clicks" label="Clics" defaultValue={link.clicks} />
                          <SmallField
                            id={`conv-${link.id}`}
                            name="conversions"
                            label="Conv."
                            defaultValue={link.conversions}
                          />
                          <SmallField
                            id={`rev-${link.id}`}
                            name="revenue"
                            label="Revenu €"
                            defaultValue={link.revenueCents / 100}
                            step="0.01"
                          />
                          <Button type="submit" size="sm" variant="outline" disabled={pending}>
                            Mettre à jour
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {linkFor === product.id ? (
                  <form
                    onSubmit={(e) => createLink(product.id, e)}
                    className="space-y-2 border-t pt-3"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="affiliateUrl">Votre lien d&apos;affiliation</Label>
                      <Input
                        id="affiliateUrl"
                        name="affiliateUrl"
                        type="url"
                        required
                        placeholder="https://…"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="videoId" className="text-xs">Vidéo</Label>
                        <Select id="videoId" name="videoId" className="h-9 text-xs">
                          <option value="">Aucune</option>
                          {videos.map((video) => (
                            <option key={video.id} value={video.id}>{video.title}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="utmCampaign" className="text-xs">UTM campaign</Label>
                        <Input id="utmCampaign" name="utmCampaign" className="h-9 text-xs" />
                      </div>
                    </div>
                    <input type="hidden" name="utmSource" value="iavid" />
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={pending}>Ajouter le lien</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setLinkFor(null)}>
                        Annuler
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setLinkFor(product.id)}>
                    <LinkIcon />
                    Ajouter un lien
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Nouveau produit</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createProduct} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nom</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand">Marque</Label>
              <Input id="brand" name="brand" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="url">URL produit</Label>
              <Input id="url" name="url" type="url" required placeholder="https://…" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="price">Prix (€)</Label>
                <Input id="price" name="price" type="number" min={0} step="0.01" defaultValue={0} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="commissionRate">Commission (%)</Label>
                <Input
                  id="commissionRate"
                  name="commissionRate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  defaultValue={0}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="category">Catégorie</Label>
                <Input id="category" name="category" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="platform">Programme</Label>
                <Input id="platform" name="platform" placeholder="Amazon, Awin…" />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              <Plus />
              Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/50 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SmallField({
  id,
  name,
  label,
  defaultValue,
  step,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: number;
  step?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        id={id}
        name={name}
        type="number"
        min={0}
        step={step ?? '1'}
        defaultValue={defaultValue}
        className="h-8 w-20 text-xs"
      />
    </div>
  );
}
