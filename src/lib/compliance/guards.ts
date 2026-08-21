/**
 * Garde-fous de conformité (§25).
 *
 * Ces règles sont appliquées côté serveur, dans les services — pas seulement
 * dans l'UI. Contourner l'interface ne contourne pas la règle.
 */

/** Hôtes dont on refuse l'import d'un média par URL: ce serait du repost. */
const PLATFORM_HOSTS: readonly string[] = [
  'tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
  'youtube.com', 'youtu.be', 'm.youtube.com',
  'instagram.com', 'cdninstagram.com',
  'snapchat.com',
  'facebook.com', 'fb.watch',
  'twitter.com', 'x.com',
  'reddit.com', 'v.redd.it',
  'twitch.tv', 'clips.twitch.tv',
  'dailymotion.com', 'vimeo.com',
  'pinterest.com',
];

export class ComplianceError extends Error {
  readonly code: string;
  readonly remedy: string;

  constructor(code: string, message: string, remedy: string) {
    super(message);
    this.name = 'ComplianceError';
    this.code = code;
    this.remedy = remedy;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isPlatformUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return PLATFORM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Refuse l'ingestion d'un média depuis une plateforme sociale.
 * Renseigner une telle URL reste possible en tant que *référence* documentaire
 * (AssetSource.EXTERNAL_REFERENCE) — c'est le téléchargement du média qui est bloqué.
 */
export function assertNotPlatformDownload(url: string): void {
  if (isPlatformUrl(url)) {
    throw new ComplianceError(
      'PLATFORM_DOWNLOAD_BLOCKED',
      "IAvid ne télécharge pas de médias depuis les plateformes sociales.",
      "Enregistrez cette URL comme référence (EXTERNAL_REFERENCE) pour vous en inspirer, " +
        "puis filmez ou générez votre propre plan. Pour réutiliser un extrait, importez le " +
        "fichier fourni par son ayant droit avec sa preuve de licence.",
    );
  }
}

/**
 * Opérations explicitement hors périmètre. Centralisées ici pour que le refus
 * soit une décision de conception documentée et non un oubli d'implémentation.
 */
export const UNSUPPORTED_OPERATIONS = {
  BULK_PLATFORM_DOWNLOAD:
    "Le téléchargement en masse de vidéos de plateformes n'est pas implémenté et ne le sera pas : c'est le cœur d'une ferme de repost.",
  WATERMARK_REMOVAL:
    "La suppression de filigrane d'une autre plateforme n'est pas implémentée : elle sert à masquer l'origine d'un contenu qui ne vous appartient pas.",
  PLATFORM_PROTECTION_BYPASS:
    "Le contournement des protections d'une plateforme (rate limits, DRM, signature de requêtes) n'est pas implémenté.",
  UNOFFICIAL_AUTOPOST:
    "La publication automatisée sans API officielle n'est pas implémentée. Quand l'API ne couvre pas l'opération, IAvid bascule en « publication manuelle requise ».",
  UNKNOWN_RIGHTS_USE:
    "Un asset dont les droits commerciaux sont inconnus ne peut pas être utilisé dans un export monétisable.",
} as const;

export type UnsupportedOperation = keyof typeof UNSUPPORTED_OPERATIONS;

export function refuse(operation: UnsupportedOperation): never {
  throw new ComplianceError(operation, UNSUPPORTED_OPERATIONS[operation], 'Voir docs/COMPLIANCE.md');
}
