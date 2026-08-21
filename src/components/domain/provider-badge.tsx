import { Badge } from '@/components/ui/badge';

/**
 * Signale qu'un résultat vient d'un fournisseur simulé.
 * Exigence de la spécification: aucune fonctionnalité fictive ne doit être
 * présentée comme fonctionnelle.
 */
export function ProviderBadge({
  provider,
  isLive,
  label,
}: {
  provider: string;
  isLive: boolean;
  label?: string;
}) {
  if (isLive) {
    return (
      <Badge variant="secondary" title={`Fournisseur: ${provider}`}>
        {label ?? provider}
      </Badge>
    );
  }
  return (
    <Badge variant="warning" title="Aucune clé d'API configurée — sortie simulée">
      Mode simulé ({provider})
    </Badge>
  );
}
