import { describe, expect, it } from 'vitest';
import {
  chunkText,
  estimateCues,
  hexToAssColor,
  toAss,
  toSrt,
  toVtt,
  type CaptionCue,
} from '@/server/render/captions';

const cues: CaptionCue[] = [
  { startMs: 0, endMs: 2500, text: 'Regarde ce résultat' },
  { startMs: 2500, endMs: 6000, text: 'Voilà comment faire' },
];

const styleOptions = {
  style: 'BOLD' as const,
  fontName: 'DejaVu Sans',
  fontSizePx: 72,
  primaryColor: '#FFFFFF',
  accentColor: '#FFD400',
  position: 'center' as const,
  width: 1080,
  height: 1920,
};

describe('SRT', () => {
  it('numérote et formate les timecodes avec une virgule', () => {
    const srt = toSrt(cues);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:02,500');
    expect(srt).toContain('2\n00:00:02,500 --> 00:00:06,000');
  });

  it('gère les durées de plus d’une heure', () => {
    expect(toSrt([{ startMs: 3_661_500, endMs: 3_662_000, text: 'x' }])).toContain('01:01:01,500');
  });
});

describe('VTT', () => {
  it('commence par l’en-tête WEBVTT et utilise un point', () => {
    const vtt = toVtt(cues);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:02.500');
  });
});

describe('ASS', () => {
  it('déclare la résolution du montage', () => {
    const ass = toAss(cues, styleOptions);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
  });

  it('produit une ligne Dialogue par réplique', () => {
    const lines = toAss(cues, styleOptions).split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(lines).toHaveLength(2);
  });

  it('convertit le RGB web en BGR ASS', () => {
    // #FFD400 → &H0000D4FF
    expect(hexToAssColor('#FFD400')).toBe('&H0000D4FF');
    expect(hexToAssColor('#000000')).toBe('&H00000000');
  });

  it('génère les balises karaoké à partir des mots', () => {
    const ass = toAss(
      [
        {
          startMs: 0,
          endMs: 1000,
          text: 'un deux',
          words: [
            { text: 'un', startMs: 0, endMs: 500 },
            { text: 'deux', startMs: 500, endMs: 1000 },
          ],
        },
      ],
      { ...styleOptions, style: 'KARAOKE' },
    );
    expect(ass).toContain('{\\k50}un');
    expect(ass).toContain('{\\k50}deux');
  });

  it('utilise un fond opaque pour le style HIGHLIGHTED', () => {
    // BorderStyle 3 = boîte pleine derrière le texte.
    expect(toAss(cues, { ...styleOptions, style: 'HIGHLIGHTED' })).toMatch(/Style: Default,[^\n]*,3,/);
  });

  it('échappe les accolades qui seraient prises pour des balises', () => {
    const ass = toAss([{ startMs: 0, endMs: 1000, text: 'accolade { ici }' }], styleOptions);
    expect(ass).toContain('accolade \\{ ici \\}');
  });

  it('remonte les sous-titres en bas d’écran pour éviter l’UI des plateformes', () => {
    const ass = toAss(cues, { ...styleOptions, position: 'bottom' });
    // 16 % de 1920 = 307
    expect(ass).toContain(',307,1');
  });
});

describe('chunkText', () => {
  it('ne coupe jamais un mot', () => {
    for (const chunk of chunkText('anticonstitutionnellement et un autre mot ici', 20)) {
      expect(chunk).not.toMatch(/^\S*-$/);
    }
  });

  it('respecte la longueur maximale sauf pour un mot plus long qu’elle', () => {
    for (const chunk of chunkText('des mots courts qui tiennent bien', 15)) {
      expect(chunk.length).toBeLessThanOrEqual(15);
    }
  });

  it('renvoie une liste vide sur un texte vide', () => {
    expect(chunkText('', 20)).toEqual([]);
  });
});

describe('estimateCues', () => {
  it('reste dans la fenêtre temporelle de chaque segment', () => {
    const result = estimateCues([
      { text: 'Première phrase assez longue pour être découpée en plusieurs répliques', startMs: 0, durationMs: 6000 },
      { text: 'Deuxième segment', startMs: 6000, durationMs: 3000 },
    ]);

    expect(result.length).toBeGreaterThan(1);
    expect(result[0]?.startMs).toBe(0);
    expect(result[result.length - 1]?.endMs).toBe(9000);
    for (const cue of result) {
      expect(cue.endMs).toBeGreaterThan(cue.startMs);
    }
  });

  it('produit des répliques qui ne se chevauchent pas', () => {
    const result = estimateCues([
      { text: 'Un texte suffisamment long pour générer au moins trois répliques distinctes ici', startMs: 0, durationMs: 9000 },
    ]);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]?.startMs).toBeGreaterThanOrEqual(result[i - 1]?.endMs ?? 0);
    }
  });

  it('ignore les segments vides', () => {
    expect(estimateCues([{ text: '   ', startMs: 0, durationMs: 3000 }])).toHaveLength(0);
  });

  it('attache des timings à chaque mot pour le karaoké', () => {
    const [cue] = estimateCues([{ text: 'trois mots ici', startMs: 0, durationMs: 3000 }]);
    expect(cue?.words).toHaveLength(3);
    expect(cue?.words?.[2]?.endMs).toBe(3000);
  });
});
