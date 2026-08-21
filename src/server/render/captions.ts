import type { CaptionStyle } from '@prisma/client';

/**
 * Génération des sous-titres (§14).
 *
 * Trois formats de sortie: SRT et VTT pour l'export/upload, ASS pour le rendu
 * brûlé (seul format capable de porter les styles animés demandés).
 */

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
  /** Mots avec timings, requis par le style karaoké. Optionnel ailleurs. */
  words?: Array<{ text: string; startMs: number; endMs: number }>;
}

export interface CaptionStyleOptions {
  style: CaptionStyle;
  fontName: string;
  fontSizePx: number;
  primaryColor: string;
  accentColor: string;
  /** Position verticale du bloc de sous-titres. */
  position: 'top' | 'center' | 'bottom';
  width: number;
  height: number;
}

// ─── Formats d'export ────────────────────────────────────────────────────────

function timestampSrt(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const msPart = clamped % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(msPart, 3)}`;
}

function timestampVtt(ms: number): string {
  return timestampSrt(ms).replace(',', '.');
}

function timestampAss(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const cs = Math.floor((clamped % 1000) / 10);
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}

export function toSrt(cues: readonly CaptionCue[]): string {
  return (
    cues
      .map(
        (cue, i) =>
          `${i + 1}\n${timestampSrt(cue.startMs)} --> ${timestampSrt(cue.endMs)}\n${cue.text.trim()}`,
      )
      .join('\n\n') + '\n'
  );
}

export function toVtt(cues: readonly CaptionCue[]): string {
  return (
    'WEBVTT\n\n' +
    cues
      .map(
        (cue) =>
          `${timestampVtt(cue.startMs)} --> ${timestampVtt(cue.endMs)}\n${cue.text.trim()}`,
      )
      .join('\n\n') +
    '\n'
  );
}

// ─── ASS: styles animés ──────────────────────────────────────────────────────

/** ASS attend &HAABBGGRR — inverse du RGB web, avec alpha en tête. */
export function hexToAssColor(hex: string, alpha = 0): string {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = full.slice(0, 2) || 'FF';
  const g = full.slice(2, 4) || 'FF';
  const b = full.slice(4, 6) || 'FF';
  return `&H${pad(alpha, 2).toUpperCase()}${b}${g}${r}`.toUpperCase();
}

const ALIGNMENT: Record<CaptionStyleOptions['position'], number> = {
  top: 8,
  center: 5,
  bottom: 2,
};

interface StyleSpec {
  bold: number;
  outline: number;
  shadow: number;
  borderStyle: number;
  /** Balises d'override appliquées à chaque réplique. */
  effect(cue: CaptionCue, opts: CaptionStyleOptions): string;
}

const STYLE_SPECS: Record<CaptionStyle, StyleSpec> = {
  MINIMAL: {
    bold: 0,
    outline: 2,
    shadow: 0,
    borderStyle: 1,
    effect: () => '',
  },
  BOLD: {
    bold: 1,
    outline: 5,
    shadow: 2,
    borderStyle: 1,
    // Léger « pop » à l'apparition: 120 ms de montée en échelle.
    effect: () => '{\\fscx85\\fscy85\\t(0,120,\\fscx100\\fscy100)}',
  },
  HIGHLIGHTED: {
    bold: 1,
    outline: 0,
    shadow: 0,
    // borderStyle 3 = boîte opaque derrière le texte.
    borderStyle: 3,
    effect: () => '',
  },
  KARAOKE: {
    bold: 1,
    outline: 4,
    shadow: 1,
    borderStyle: 1,
    effect: (cue) => {
      if (!cue.words || cue.words.length === 0) return '';
      // \k prend des centisecondes; on reconstruit la réplique mot à mot.
      return cue.words
        .map((w) => `{\\k${Math.max(1, Math.round((w.endMs - w.startMs) / 10))}}${w.text}`)
        .join(' ');
    },
  },
  CENTERED: {
    bold: 1,
    outline: 3,
    shadow: 1,
    borderStyle: 1,
    effect: () => '{\\fad(120,120)}',
  },
};

export function toAss(cues: readonly CaptionCue[], opts: CaptionStyleOptions): string {
  const spec = STYLE_SPECS[opts.style];
  const primary = hexToAssColor(opts.primaryColor);
  const accent = hexToAssColor(opts.accentColor);
  const outlineColor = opts.style === 'HIGHLIGHTED' ? hexToAssColor('#111827', 40) : hexToAssColor('#000000');
  const alignment = ALIGNMENT[opts.position];

  // Marge verticale: en vertical 9:16 les UI des plateformes mangent le bas de l'écran.
  const marginV =
    opts.position === 'bottom'
      ? Math.round(opts.height * 0.16)
      : opts.position === 'top'
        ? Math.round(opts.height * 0.14)
        : 10;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Default',
      opts.fontName,
      String(opts.fontSizePx),
      primary,
      accent,
      outlineColor,
      hexToAssColor('#000000', 60),
      String(spec.bold),
      '0',
      '0',
      '0',
      '100',
      '100',
      '0',
      '0',
      String(spec.borderStyle),
      String(spec.outline),
      String(spec.shadow),
      String(alignment),
      String(Math.round(opts.width * 0.08)),
      String(Math.round(opts.width * 0.08)),
      String(marginV),
      '1',
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const events = cues.map((cue) => {
    const rendered = spec.effect(cue, opts);
    const body =
      opts.style === 'KARAOKE' && rendered
        ? rendered
        : `${rendered}${escapeAssText(cue.text)}`;
    return `Dialogue: 0,${timestampAss(cue.startMs)},${timestampAss(cue.endMs)},Default,,0,0,0,,${body}`;
  });

  return `${header}\n${events.join('\n')}\n`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

// ─── Découpage en répliques ──────────────────────────────────────────────────

/**
 * Répartit un texte de narration sur une fenêtre temporelle.
 *
 * Utilisé quand aucune transcription n'est disponible: les mots sont pondérés
 * par leur longueur, ce qui approche mieux le débit réel qu'une répartition
 * uniforme. Le résultat est étiqueté `estimated`, jamais présenté comme transcrit.
 */
export function estimateCues(
  segments: ReadonlyArray<{ text: string; startMs: number; durationMs: number }>,
  maxCharsPerCue = 42,
): CaptionCue[] {
  const cues: CaptionCue[] = [];

  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;

    const chunks = chunkText(text, maxCharsPerCue);
    const totalWeight = chunks.reduce((sum, c) => sum + c.length, 0);
    if (totalWeight === 0) continue;

    let cursor = segment.startMs;
    chunks.forEach((chunk, i) => {
      const share = (chunk.length / totalWeight) * segment.durationMs;
      const start = cursor;
      const end = i === chunks.length - 1 ? segment.startMs + segment.durationMs : cursor + share;
      cursor = end;

      const words = splitWordsEvenly(chunk, start, end);
      cues.push({ startMs: Math.round(start), endMs: Math.round(end), text: chunk, words });
    });
  }

  return cues;
}

/** Découpe sur les frontières de mots, sans jamais couper un mot en deux. */
export function chunkText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitWordsEvenly(chunk: string, startMs: number, endMs: number) {
  const words = chunk.split(/\s+/).filter(Boolean);
  const totalChars = words.reduce((sum, w) => sum + w.length, 0) || 1;
  const span = endMs - startMs;
  let cursor = startMs;
  return words.map((word, i) => {
    const share = (word.length / totalChars) * span;
    const start = cursor;
    const end = i === words.length - 1 ? endMs : cursor + share;
    cursor = end;
    return { text: word, startMs: Math.round(start), endMs: Math.round(end) };
  });
}
