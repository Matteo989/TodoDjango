import type { AssetSource, CommercialUse, RightsStatus } from '@prisma/client';

/**
 * Gestion des droits (§6, §24).
 *
 * Règle centrale: l'absence d'information n'est jamais une autorisation.
 * UNKNOWN → 🟠 NEEDS_REVIEW, et un export monétisable est refusé.
 */

export interface RightsInput {
  source: AssetSource;
  commercialUse: CommercialUse;
  license?: string | null;
  proofKey?: string | null;
  proofUrl?: string | null;
  expiresAt?: Date | null;
}

export interface RightsEvaluation {
  status: RightsStatus;
  /** Vrai uniquement si l'asset peut entrer dans un export commercial. */
  commerciallyUsable: boolean;
  reasons: string[];
}

export function evaluateRights(input: RightsInput, now: Date = new Date()): RightsEvaluation {
  const reasons: string[] = [];

  if (input.commercialUse === 'DENIED') {
    return {
      status: 'BLOCKED',
      commerciallyUsable: false,
      reasons: ['Usage commercial explicitement interdit par la licence.'],
    };
  }

  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
    return {
      status: 'BLOCKED',
      commerciallyUsable: false,
      reasons: [`Licence expirée le ${input.expiresAt.toISOString().slice(0, 10)}.`],
    };
  }

  // Une référence externe est documentaire: elle ne va jamais dans un montage.
  if (input.source === 'EXTERNAL_REFERENCE') {
    return {
      status: 'BLOCKED',
      commerciallyUsable: false,
      reasons: [
        "Référence externe : conservée pour inspiration, jamais intégrée à un montage.",
      ],
    };
  }

  if (input.source === 'OWNED' || input.source === 'PUBLIC_DOMAIN' || input.source === 'AI_GENERATED') {
    if (input.commercialUse === 'ALLOWED') {
      return { status: 'CLEARED', commerciallyUsable: true, reasons: [] };
    }
    reasons.push(
      input.source === 'AI_GENERATED'
        ? "Contenu généré par IA : confirmer que les conditions du fournisseur autorisent l'usage commercial."
        : "Confirmer l'usage commercial pour lever la vérification.",
    );
    return { status: 'NEEDS_REVIEW', commerciallyUsable: false, reasons };
  }

  // LICENSED: exige licence nommée + preuve + autorisation explicite.
  if (!input.license) reasons.push('Licence non renseignée.');
  if (!input.proofKey && !input.proofUrl) reasons.push('Preuve de licence absente.');
  if (input.commercialUse !== 'ALLOWED') reasons.push('Usage commercial non confirmé.');

  if (reasons.length === 0) {
    return { status: 'CLEARED', commerciallyUsable: true, reasons: [] };
  }
  return { status: 'NEEDS_REVIEW', commerciallyUsable: false, reasons };
}

export const RIGHTS_INDICATOR: Record<RightsStatus, { emoji: string; label: string; tone: string }> = {
  CLEARED: { emoji: '🟢', label: 'Commercialement utilisable', tone: 'success' },
  NEEDS_REVIEW: { emoji: '🟠', label: 'Vérification nécessaire', tone: 'warning' },
  BLOCKED: { emoji: '🔴', label: 'Interdit', tone: 'destructive' },
};

/** Musique: on ne propose jamais automatiquement un morceau aux droits inconnus (§15). */
export function musicSelectableForAutoPick(commercialUse: CommercialUse): boolean {
  return commercialUse === 'ALLOWED';
}
