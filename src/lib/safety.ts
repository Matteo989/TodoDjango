/**
 * Détection déterministe des sujets de bricolage à risque.
 *
 * Volontairement lexicale et exécutée AVANT tout appel à un modèle: la sécurité
 * des utilisateurs ne doit pas dépendre du fait qu'un LLM ait pensé à prévenir.
 * Un LLM peut enrichir l'avertissement, jamais décider qu'il est inutile.
 */

export type SafetyTopic =
  | 'electricity'
  | 'gas'
  | 'structural'
  | 'power_tools'
  | 'chemicals'
  | 'height'
  | 'asbestos'
  | 'water_supply';

export interface SafetyRule {
  topic: SafetyTopic;
  label: string;
  /** Termes FR + EN, comparés sur du texte normalisé sans accents. */
  terms: string[];
  warning: string;
  /** Plafond appliqué au SAFETY_SCORE quand le sujet est présent. */
  scoreCap: number;
}

export const SAFETY_RULES: readonly SafetyRule[] = [
  {
    topic: 'electricity',
    label: 'Électricité',
    terms: [
      'electricite', 'electrique', 'prise de courant', 'tableau electrique', 'disjoncteur',
      'cablage', 'cable electrique', 'interrupteur', 'phase neutre', '220v', '230v',
      'compteur', 'differentiel', 'electrical', 'wiring', 'circuit breaker', 'outlet',
    ],
    warning:
      "Intervention électrique : couper le disjoncteur et vérifier l'absence de tension. Dans de nombreux pays, les travaux sur le tableau ou l'alimentation relèvent d'un électricien qualifié.",
    scoreCap: 55,
  },
  {
    topic: 'gas',
    label: 'Gaz',
    terms: ['gaz', 'chaudiere', 'gaziniere', 'butane', 'propane', 'monoxyde', 'gas line', 'boiler'],
    warning:
      "Installation gaz : toute intervention sur une conduite ou un appareil à gaz doit être réalisée par un professionnel certifié. Une fuite peut être mortelle.",
    scoreCap: 40,
  },
  {
    topic: 'structural',
    label: 'Structure porteuse',
    terms: [
      'mur porteur', 'poutre', 'solive', 'charpente', 'fondation', 'linteau', 'dalle beton',
      'load bearing', 'joist', 'beam', 'foundation',
    ],
    warning:
      "Élément porteur : une ouverture ou une découpe sans étude structurelle peut provoquer un effondrement. Faire valider par un ingénieur ou un bureau d'études.",
    scoreCap: 45,
  },
  {
    topic: 'power_tools',
    label: 'Outils dangereux',
    terms: [
      'scie circulaire', 'scie sauteuse', 'meuleuse', 'disqueuse', 'tronconneuse', 'raboteuse',
      'defonceuse', 'cloueuse', 'circular saw', 'angle grinder', 'chainsaw', 'nail gun',
    ],
    warning:
      "Outil à risque : porter lunettes, gants et protection auditive. Ne jamais retirer le carter de protection ni tenir la pièce à la main.",
    scoreCap: 70,
  },
  {
    topic: 'chemicals',
    label: 'Produits chimiques',
    terms: [
      'decapant', 'acide', 'soude', 'javel', 'ammoniaque', 'solvant', 'white spirit',
      'resine epoxy', 'isocyanate', 'bleach', 'solvent', 'lye',
    ],
    warning:
      "Produits chimiques : travailler en local ventilé, porter gants et masque adapté, et ne jamais mélanger deux produits (javel + acide dégage un gaz toxique).",
    scoreCap: 60,
  },
  {
    topic: 'height',
    label: 'Travail en hauteur',
    terms: ['echelle', 'echafaudage', 'toiture', 'toit', 'gouttiere', 'ladder', 'scaffold', 'roof'],
    warning:
      "Travail en hauteur : stabiliser l'échelle, ne jamais travailler seul, utiliser un harnais au-delà de 3 mètres. Les chutes sont la première cause d'accident domestique grave.",
    scoreCap: 60,
  },
  {
    topic: 'asbestos',
    label: 'Amiante / plomb',
    terms: ['amiante', 'plomb', 'fibrociment', 'asbestos', 'lead paint'],
    warning:
      "Amiante ou plomb suspecté : ne pas poncer, percer ni découper. Faire diagnostiquer par un professionnel agréé — les fibres et poussières sont cancérogènes.",
    scoreCap: 30,
  },
  {
    topic: 'water_supply',
    label: 'Plomberie sous pression',
    terms: ['arrivee d eau', 'coupure d eau', 'soudure cuivre', 'chauffe-eau', 'water heater', 'plumbing'],
    warning:
      "Plomberie : couper l'arrivée d'eau générale et purger le circuit avant toute intervention. Un chauffe-eau sous pression peut causer des brûlures graves.",
    scoreCap: 70,
  },
] as const;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export interface SafetyDetection {
  topic: SafetyTopic;
  label: string;
  warning: string;
  matchedTerms: string[];
}

export function detectSafetyTopics(text: string): SafetyDetection[] {
  const haystack = normalize(text);
  const found: SafetyDetection[] = [];
  for (const rule of SAFETY_RULES) {
    const matchedTerms = rule.terms.filter((term) => haystack.includes(term));
    if (matchedTerms.length > 0) {
      found.push({
        topic: rule.topic,
        label: rule.label,
        warning: rule.warning,
        matchedTerms,
      });
    }
  }
  return found;
}

/** Plafond du SAFETY_SCORE imposé par les sujets détectés (100 si aucun). */
export function safetyScoreCap(text: string): number {
  const topics = detectSafetyTopics(text);
  if (topics.length === 0) return 100;
  return topics.reduce((cap, t) => {
    const rule = SAFETY_RULES.find((r) => r.topic === t.topic);
    return Math.min(cap, rule?.scoreCap ?? 100);
  }, 100);
}

export function requiresSafetyWarning(text: string): boolean {
  return detectSafetyTopics(text).length > 0;
}
