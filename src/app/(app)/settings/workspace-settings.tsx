'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';

export function WorkspaceSettings({
  workspace,
}: {
  workspace: { name: string; locale: string; niche: string; aiBudgetCentsMonthly: number };
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setSaved(false);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name')),
          locale: String(form.get('locale')),
          niche: String(form.get('niche')),
          aiBudgetCentsMonthly: Math.round(Number(form.get('budget')) * 100),
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
        <CardTitle className="text-base">Workspace</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {saved ? <Alert tone="success">Enregistré.</Alert> : null}

          <div className="space-y-1.5">
            <Label htmlFor="name">Nom</Label>
            <Input id="name" name="name" defaultValue={workspace.name} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="niche">Niche</Label>
            <Input id="niche" name="niche" defaultValue={workspace.niche} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="locale">Langue par défaut</Label>
            <Select id="locale" name="locale" defaultValue={workspace.locale}>
              <option value="fr">Français</option>
              <option value="en">English</option>
              <option value="de">Deutsch</option>
              <option value="es">Español</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="budget">Plafond IA mensuel (€)</Label>
            <Input
              id="budget"
              name="budget"
              type="number"
              min={0}
              step="0.5"
              defaultValue={(workspace.aiBudgetCentsMonthly / 100).toFixed(2)}
            />
            <p className="text-xs text-muted-foreground">
              0 = aucun plafond. Au-delà, les générations IA sont refusées jusqu&apos;au mois
              suivant — garde-fou contre une boucle de génération coûteuse.
            </p>
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
