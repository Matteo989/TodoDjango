import type { CommercialUse, RightsStatus } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
import { RIGHTS_INDICATOR } from '@/lib/rights';

/**
 * Indicateur de droits (§24). Le tri-état est visuel ET textuel: une pastille
 * seule ne dit pas si l'absence d'information vaut autorisation.
 */
export function RightsBadge({ status }: { status: RightsStatus | null | undefined }) {
  if (!status) {
    return (
      <Badge variant="warning" title="Aucun enregistrement de droits">
        🟠 Droits non renseignés
      </Badge>
    );
  }

  const indicator = RIGHTS_INDICATOR[status];
  const variant =
    status === 'CLEARED' ? 'success' : status === 'NEEDS_REVIEW' ? 'warning' : 'destructive';

  return (
    <Badge variant={variant}>
      {indicator.emoji} {indicator.label}
    </Badge>
  );
}

export function CommercialUseBadge({ value }: { value: CommercialUse }) {
  const map = {
    ALLOWED: { variant: 'success' as const, label: 'Usage commercial autorisé' },
    DENIED: { variant: 'destructive' as const, label: 'Usage commercial interdit' },
    UNKNOWN: { variant: 'warning' as const, label: '⚠️ DROITS NON VALIDÉS' },
  };
  const entry = map[value];
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
