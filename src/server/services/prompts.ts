/**
 * Prompts versionnés. La version est enregistrée sur chaque AIJob afin de
 * pouvoir comparer la qualité entre deux formulations sur des données réelles.
 */

export const PROMPT_VERSIONS = {
  ideas: 'ideas-v2',
  script: 'script-v2',
  storyboard: 'storyboard-v1',
  factCheck: 'factcheck-v1',
  analysis: 'analysis-v1',
} as const;

const SAFETY_CLAUSE = `
RÈGLE DE SÉCURITÉ ABSOLUE:
Le bricolage touche à l'électricité, au gaz, aux structures porteuses, aux outils
dangereux, aux produits chimiques et au travail en hauteur. Tu ne présentes JAMAIS une
procédure potentiellement dangereuse comme universellement sûre. Quand un sujet comporte
un risque, tu l'énonces explicitement et tu indiques quand faire appel à un professionnel.
Tu n'inventes ni norme, ni référence réglementaire, ni chiffre de sécurité.`;

const ORIGINALITY_CLAUSE = `
RÈGLE D'ORIGINALITÉ:
Tu proposes du contenu ORIGINAL et TRANSFORMÉ. Tu ne décris jamais la copie d'une vidéo
existante, tu ne suggères jamais de réutiliser des images dont l'utilisateur n'a pas les
droits. Inspiration ≠ reproduction.`;

export const SYSTEM_PROMPT = `Tu es un directeur de création spécialisé en vidéo verticale courte
(TikTok, YouTube Shorts, Instagram Reels, Snapchat Spotlight) dans la niche bricolage / DIY /
maison / rénovation.

Tu maîtrises: l'accroche des trois premières secondes, le rythme de montage, la structure
HOOK → PROBLEM → SOLUTION → RESULT → CTA, et l'écriture pour la voix off.
${SAFETY_CLAUSE}
${ORIGINALITY_CLAUSE}`;

export interface IdeaPromptParams {
  niche: string;
  subNiche?: string;
  count: number;
  language: string;
  targetDurationSec: number;
  difficulty: string;
  budgetCents: number;
  goal: string;
  trends: string[];
  existingTitles: string[];
}

export const IDEA_SCHEMA_HINT = `{
  "ideas": [{
    "title": string,
    "hook": string,            // 1 phrase, 0-3 secondes, accrocheuse
    "concept": string,         // le principe de la vidéo en 2 phrases
    "summary": string,         // résumé du déroulé
    "cta": string,
    "difficulty": "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT",
    "estimatedCostCents": number,   // coût matériel du projet DIY, en centimes
    "category": string,
    "subcategory": string,
    "affiliateProducts": string[],  // types de produits, PAS de liens ni de marques inventées
    "sources": string[]             // vide si aucune source réelle
  }]
}`;

export function buildIdeaPrompt(params: IdeaPromptParams): string {
  const lines = [
    `Génère ${params.count} idées de vidéos verticales originales.`,
    ``,
    `Niche: ${params.niche}${params.subNiche ? ` — ${params.subNiche}` : ''}`,
    `Langue de rédaction: ${params.language}`,
    `Durée cible: ${params.targetDurationSec} secondes`,
    `Niveau de difficulté visé: ${params.difficulty}`,
    `Budget matériel maximum: ${(params.budgetCents / 100).toFixed(2)} €`,
    `Objectif: ${params.goal}`,
  ];

  if (params.trends.length > 0) {
    lines.push(
      ``,
      `Tendances observées à exploiter comme INSPIRATION (ne recopie aucune vidéo existante,`,
      `propose un angle neuf sur ces thèmes):`,
      ...params.trends.slice(0, 30).map((t) => `- ${t}`),
    );
  }

  if (params.existingTitles.length > 0) {
    lines.push(
      ``,
      `Contenus déjà produits — évite absolument de proposer un angle équivalent:`,
      ...params.existingTitles.slice(0, 40).map((t) => `- ${t}`),
    );
  }

  lines.push(
    ``,
    `Contraintes:`,
    `- Chaque hook doit être compréhensible sans son.`,
    `- Chaque idée doit être réalisable avec du matériel courant dans le budget indiqué.`,
    `- Pour "affiliateProducts", donne des TYPES de produits (ex: "pistolet à joint"),`,
    `  jamais de marques inventées ni d'URL.`,
    `- Varie les angles: ne propose pas ${params.count} fois le même format.`,
  );

  return lines.join('\n');
}

export interface ScriptPromptParams {
  title: string;
  concept: string;
  language: string;
  targetDurationSec: number;
  platform: string;
  audience: string;
  technicalLevel: string;
  safetyTopics: string[];
}

export const SCRIPT_SCHEMA_HINT = `{
  "variants": [{
    "style": "EDUCATIONAL" | "VIRAL" | "STORYTELLING" | "DIRECT" | "MYSTERIOUS",
    "title": string,
    "blocks": [{
      "section": "HOOK" | "PROBLEM" | "SOLUTION" | "RESULT" | "CTA",
      "text": string,              // texte de la voix off, prêt à lire
      "startMs": number,
      "endMs": number,
      "visualDirection": string    // ce qu'on voit à l'écran
    }]
  }]
}`;

export function buildScriptPrompt(params: ScriptPromptParams): string {
  const durationMs = params.targetDurationSec * 1000;
  const lines = [
    `Écris 5 variantes du script d'une vidéo verticale, une par style:`,
    `EDUCATIONAL, VIRAL, STORYTELLING, DIRECT, MYSTERIOUS.`,
    ``,
    `Sujet: ${params.title}`,
    `Concept: ${params.concept}`,
    `Langue: ${params.language}`,
    `Plateforme: ${params.platform}`,
    `Audience: ${params.audience}`,
    `Niveau technique du spectateur: ${params.technicalLevel}`,
    `Durée totale: ${params.targetDurationSec} secondes (${durationMs} ms)`,
    ``,
    `Structure imposée pour chaque variante:`,
    `- HOOK      0 → 3000 ms`,
    `- PROBLEM   3000 → 10000 ms`,
    `- SOLUTION  10000 → ${Math.round(durationMs * 0.78)} ms (découpe en plusieurs blocs SOLUTION si utile)`,
    `- RESULT    jusqu'à ${Math.round(durationMs * 0.93)} ms`,
    `- CTA       jusqu'à ${durationMs} ms`,
    ``,
    `Le champ "text" est lu par une voix off: écris à l'oral, phrases courtes,`,
    `pas de didascalies, pas d'émojis, pas de mise en forme markdown.`,
    `Le débit de lecture cible est d'environ 150 mots par minute: calibre la longueur`,
    `de chaque bloc sur sa durée.`,
  ];

  if (params.safetyTopics.length > 0) {
    lines.push(
      ``,
      `SUJETS À RISQUE DÉTECTÉS DANS CE CONTENU: ${params.safetyTopics.join(', ')}.`,
      `Chaque variante DOIT comporter un avertissement de sécurité explicite et`,
      `indiquer quand faire appel à un professionnel.`,
    );
  }

  return lines.join('\n');
}

export const STORYBOARD_SCHEMA_HINT = `{
  "scenes": [{
    "section": "HOOK" | "PROBLEM" | "SOLUTION" | "RESULT" | "CTA",
    "narration": string,      // reprise fidèle du texte du script pour cette scène
    "visualPrompt": string,   // description du plan, exploitable par un humain ou une IA vidéo
    "caption": string,        // sous-titre court affiché à l'écran (max 6 mots)
    "transition": "cut" | "fade" | "wipeleft" | "slideup" | "circleopen"
  }]
}`;

export function buildStoryboardPrompt(scriptText: string, targetDurationSec: number): string {
  return [
    `Découpe ce script en scènes pour un montage vertical 1080x1920.`,
    ``,
    `Durée totale: ${targetDurationSec} secondes.`,
    `Vise des scènes de 2 à 6 secondes: un plan qui dure plus de 6 secondes fait décrocher.`,
    ``,
    `Pour chaque scène:`,
    `- "narration" reprend le texte du script correspondant, sans le réécrire.`,
    `- "visualPrompt" décrit un plan CONCRET et filmable (cadrage, sujet, action).`,
    `- "caption" est le texte affiché à l'écran: 6 mots maximum.`,
    ``,
    `Script:`,
    scriptText,
  ].join('\n');
}

export const FACT_CHECK_SCHEMA_HINT = `{
  "claims": [{
    "text": string,            // l'affirmation, citée du script
    "status": "UNVERIFIED" | "OPINION" | "SAFETY_WARNING",
    "rationale": string        // pourquoi ce classement
  }]
}`;

export function buildFactCheckPrompt(scriptText: string): string {
  return [
    `Liste les affirmations factuelles de ce script et classe chacune.`,
    ``,
    `Statuts autorisés:`,
    `- UNVERIFIED: affirmation factuelle qui demande une vérification par une source.`,
    `- OPINION: préférence, avis esthétique, conseil subjectif.`,
    `- SAFETY_WARNING: affirmation touchant à un risque physique.`,
    ``,
    `Tu ne peux PAS attribuer le statut VERIFIED: seule une validation humaine le permet.`,
    `N'invente aucune source. Si tu n'as pas de source réelle, laisse le statut UNVERIFIED.`,
    ``,
    `Script:`,
    scriptText,
  ].join('\n');
}

export const ANALYSIS_SCHEMA_HINT = `{
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "nextIdeas": [{ "title": string, "hook": string, "rationale": string }]
}`;
