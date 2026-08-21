/**
 * Construction du graphe de filtres FFmpeg (§13).
 *
 * Ce module est PUR: il transforme un plan de rendu en argv. Aucun accès disque,
 * aucun process. C'est ce qui permet de tester le montage sans exécuter FFmpeg,
 * et de logger exactement la commande qui a échoué (risque R1).
 */

export type SceneSource =
  | { kind: 'video'; path: string; trimStartMs?: number; trimEndMs?: number }
  | { kind: 'image'; path: string }
  /** Aucun asset rattaché: on rend une ardoise lisible plutôt qu'un écran noir. */
  | { kind: 'placeholder'; labelFile: string };

export interface RenderScene {
  durationMs: number;
  source: SceneSource;
  /** Transition VERS la scène suivante. 'cut' = coupe franche. */
  transition: 'cut' | 'fade' | 'wipeleft' | 'slideup' | 'circleopen';
  /** Facteur de mouvement pour les images fixes (1 = statique). */
  zoom: number;
}

export interface RenderPlan {
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  scenes: RenderScene[];
  voicePath?: string | null;
  musicPath?: string | null;
  /** 0–1. La voix reste au premier plan. */
  musicVolume: number;
  /** Fichier .ass déjà stylé; les sous-titres sont brûlés dans l'image. */
  subtitlePath?: string | null;
  watermarkPath?: string | null;
  /** 'draft' privilégie la vitesse, 'final' la qualité d'export. */
  preset: 'draft' | 'final';
  fontFile: string;
}

export interface BuiltCommand {
  args: string[];
  expectedDurationMs: number;
  /** Détail des segments, utile aux tests et au débogage. */
  segments: Array<{ index: number; durationMs: number; kind: SceneSource['kind'] }>;
}

const XFADE_MAX_MS = 500;

/** Échappe un chemin pour un argument de filtre FFmpeg (subtitles/ass, drawtext). */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Durée de la transition entre deux scènes, bornée pour ne jamais avaler un plan. */
export function transitionDurationMs(currentMs: number, nextMs: number): number {
  return Math.max(0, Math.min(XFADE_MAX_MS, Math.floor(Math.min(currentMs, nextMs) * 0.3)));
}

/**
 * Compense le temps avalé par les fondus.
 *
 * Un enchaînement xfade fait se recouvrir deux plans: la vidéo finale est donc
 * plus courte que la somme des scènes. Une cible de 30 s doit rendre 30 s —
 * notamment parce que le contrôle qualité mesure le fichier réel et que le
 * seuil des 60 s de TikTok se joue à la seconde près.
 *
 * Les durées ne font qu'augmenter, ce qui peut à son tour allonger un fondu
 * (borné à 30 % de la plus courte scène). On itère donc jusqu'au point fixe.
 */
export function compensateForTransitions(
  scenes: readonly RenderScene[],
  targetMs: number,
): RenderScene[] {
  if (scenes.length < 2) return [...scenes];

  let current = scenes.map((scene) => ({ ...scene }));

  for (let pass = 0; pass < 5; pass += 1) {
    const overlapMs = totalOverlapMs(current);
    if (overlapMs === 0) break;

    const rendered = current.reduce((sum, s) => sum + s.durationMs, 0) - overlapMs;
    const deficit = targetMs - rendered;
    if (Math.abs(deficit) <= 1) break;

    const weights = current.map((s) => s.durationMs);
    const shares = distributeInt(deficit, weights);
    current = current.map((scene, i) => ({
      ...scene,
      durationMs: Math.max(300, scene.durationMs + (shares[i] ?? 0)),
    }));
  }

  return current;
}

/** Somme des recouvrements introduits par les fondus entre scènes consécutives. */
export function totalOverlapMs(scenes: readonly RenderScene[]): number {
  let total = 0;
  for (let i = 0; i < scenes.length - 1; i += 1) {
    const current = scenes[i];
    const next = scenes[i + 1];
    if (!current || !next || current.transition === 'cut') continue;
    total += transitionDurationMs(current.durationMs, next.durationMs);
  }
  return total;
}

/** Répartit un entier (éventuellement négatif) au prorata des poids, sans perte. */
function distributeInt(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const raw = weights.map((w) => (w / sum) * magnitude);
  const floored = raw.map((v) => Math.floor(v));

  let remainder = magnitude - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floored[i] = (floored[i] ?? 0) + 1;
    remainder -= 1;
  }

  return floored.map((v) => v * sign);
}

function normalizeChain(width: number, height: number, fps: number): string {
  // increase + crop = recadrage 9:16 sans bandes noires, quelle que soit la source.
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    `fps=${fps}`,
    'format=yuv420p',
    // settb=AVTB aligne la base de temps de tous les segments sur celle que
    // xfade produit en sortie (1/1000000). Sans cela, chaîner deux fondus
    // échoue: le second reçoit une entrée en 1/1000000 et une en 1/fps.
    'settb=AVTB',
  ].join(',');
}

/**
 * Panoramique lent sur les images fixes.
 * Choix délibéré du couple scale+crop animé plutôt que `zoompan`: zoompan
 * produit un tremblement visible sur les longues durées et coûte bien plus cher
 * en CPU, alors qu'un crop à offset animé est stable et exact.
 */
function stillMotionChain(width: number, height: number, fps: number, zoom: number, durationSec: number): string {
  if (zoom <= 1.001) return normalizeChain(width, height, fps);
  const scaledW = Math.ceil((width * zoom) / 2) * 2;
  const scaledH = Math.ceil((height * zoom) / 2) * 2;
  const d = Math.max(0.1, durationSec).toFixed(3);
  return [
    `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase`,
    `crop=${scaledW}:${scaledH}`,
    `crop=${width}:${height}:'(iw-ow)/2':'(ih-oh)*min(1\\,t/${d})'`,
    'setsar=1',
    `fps=${fps}`,
    'format=yuv420p',
    'settb=AVTB',
  ].join(',');
}

export function buildRenderCommand(plan: RenderPlan): BuiltCommand {
  if (plan.scenes.length === 0) {
    throw new Error('Le storyboard ne contient aucune scène: rien à monter.');
  }

  const { width, height, fps } = plan;
  const inputs: string[] = [];
  const filters: string[] = [];
  const segments: BuiltCommand['segments'] = [];
  const videoLabels: string[] = [];

  plan.scenes.forEach((scene, index) => {
    const durationSec = Math.max(0.1, scene.durationMs / 1000);
    const currentInput = countInputs(inputs);

    switch (scene.source.kind) {
      case 'video': {
        const start = (scene.source.trimStartMs ?? 0) / 1000;
        if (start > 0) inputs.push('-ss', start.toFixed(3));
        inputs.push('-i', scene.source.path);
        // tpad clone la dernière image si la source est plus courte que la scène,
        // puis trim coupe à la durée exacte: aucune scène ne peut « manquer ».
        filters.push(
          `[${currentInput}:v]${normalizeChain(width, height, fps)},` +
            `tpad=stop_mode=clone:stop_duration=${durationSec.toFixed(3)},` +
            `trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
        );
        break;
      }

      case 'image': {
        inputs.push('-loop', '1', '-t', durationSec.toFixed(3), '-i', scene.source.path);
        filters.push(
          `[${currentInput}:v]${stillMotionChain(width, height, fps, scene.zoom, durationSec)},` +
            `trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
        );
        break;
      }

      case 'placeholder': {
        inputs.push(
          '-f', 'lavfi',
          '-i', `color=c=0x14161f:s=${width}x${height}:r=${fps}:d=${durationSec.toFixed(3)}`,
        );
        // Le libellé passe par un fichier: le texte des scènes contient des
        // apostrophes, des accents et des deux-points qui casseraient drawtext inline.
        // L'ardoise occupe le tiers supérieur: le centre de l'image est
        // réservé aux sous-titres brûlés, qui s'y afficheraient par-dessus.
        const slateTop = Math.round(height * 0.1);
        const slateHeight = Math.round(height * 0.2);

        filters.push(
          `[${currentInput}:v]` +
            `drawbox=x=0:y=${slateTop}:w=${width}:h=${slateHeight}:` +
            `color=0x1f2937@0.85:t=fill,` +
            `drawtext=fontfile='${escapeFilterPath(plan.fontFile)}':` +
            `textfile='${escapeFilterPath(scene.source.labelFile)}':` +
            `fontcolor=0xE5E7EB:fontsize=44:line_spacing=12:` +
            `x=(w-text_w)/2:y=${slateTop}+(${slateHeight}-text_h)/2:box=0,` +
            `setsar=1,format=yuv420p,settb=AVTB,` +
            `trim=duration=${durationSec.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
        );
        break;
      }
    }

    videoLabels.push(`v${index}`);
    segments.push({ index, durationMs: scene.durationMs, kind: scene.source.kind });
  });

  // ── Assemblage des segments ────────────────────────────────────────────────
  const useTransitions = plan.scenes.some((s, i) => s.transition !== 'cut' && i < plan.scenes.length - 1);
  let currentLabel: string;
  let expectedDurationMs: number;

  if (!useTransitions || plan.scenes.length === 1) {
    if (plan.scenes.length === 1) {
      currentLabel = 'v0';
    } else {
      filters.push(
        `${videoLabels.map((l) => `[${l}]`).join('')}concat=n=${videoLabels.length}:v=1:a=0[vcat]`,
      );
      currentLabel = 'vcat';
    }
    expectedDurationMs = plan.scenes.reduce((sum, s) => sum + s.durationMs, 0);
  } else {
    // Chaîne xfade: l'offset de chaque fondu est cumulé et diminué des
    // recouvrements précédents, sinon les transitions dérivent scène après scène.
    let accumulatedMs = plan.scenes[0]?.durationMs ?? 0;
    let previous = 'v0';
    for (let i = 1; i < plan.scenes.length; i += 1) {
      const prevScene = plan.scenes[i - 1];
      const scene = plan.scenes[i];
      if (!prevScene || !scene) continue;

      const transition = prevScene.transition === 'cut' ? 'fade' : prevScene.transition;
      const overlapMs =
        prevScene.transition === 'cut'
          ? 0
          : transitionDurationMs(prevScene.durationMs, scene.durationMs);

      const out = `x${i}`;
      if (overlapMs === 0) {
        filters.push(`[${previous}][v${i}]concat=n=2:v=1:a=0[${out}]`);
        accumulatedMs += scene.durationMs;
      } else {
        const offsetSec = ((accumulatedMs - overlapMs) / 1000).toFixed(3);
        filters.push(
          `[${previous}][v${i}]xfade=transition=${transition}:` +
            `duration=${(overlapMs / 1000).toFixed(3)}:offset=${offsetSec}[${out}]`,
        );
        accumulatedMs += scene.durationMs - overlapMs;
      }
      previous = out;
    }
    currentLabel = previous;
    expectedDurationMs = accumulatedMs;
  }

  // ── Filigrane ──────────────────────────────────────────────────────────────
  if (plan.watermarkPath) {
    const wmIndex = countInputs(inputs);
    inputs.push('-i', plan.watermarkPath);
    const margin = Math.round(width * 0.045);
    filters.push(
      `[${wmIndex}:v]scale=${Math.round(width * 0.18)}:-1[wm]`,
      `[${currentLabel}][wm]overlay=W-w-${margin}:H-h-${margin * 3}[vwm]`,
    );
    currentLabel = 'vwm';
  }

  // ── Sous-titres brûlés ─────────────────────────────────────────────────────
  if (plan.subtitlePath) {
    filters.push(`[${currentLabel}]ass='${escapeFilterPath(plan.subtitlePath)}'[vsub]`);
    currentLabel = 'vsub';
  }

  // ── Audio ──────────────────────────────────────────────────────────────────
  const totalSec = expectedDurationMs / 1000;
  const audioParts: string[] = [];

  if (plan.voicePath) {
    const idx = countInputs(inputs);
    inputs.push('-i', plan.voicePath);
    filters.push(
      `[${idx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
        `apad,atrim=duration=${totalSec.toFixed(3)},asetpts=PTS-STARTPTS[avoice]`,
    );
    audioParts.push('avoice');
  }

  if (plan.musicPath) {
    const idx = countInputs(inputs);
    // stream_loop: une musique de 20 s doit couvrir une vidéo de 60 s.
    inputs.push('-stream_loop', '-1', '-i', plan.musicPath);
    const fadeStart = Math.max(0, totalSec - 1.5).toFixed(3);
    filters.push(
      `[${idx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
        `volume=${plan.musicVolume.toFixed(3)},` +
        `atrim=duration=${totalSec.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=t=out:st=${fadeStart}:d=1.5[amusic]`,
    );
    audioParts.push('amusic');
  }

  let audioLabel: string;
  if (audioParts.length === 0) {
    // Une piste audio est toujours présente: plusieurs plateformes rejettent un
    // MP4 sans flux audio, et le contrôle qualité vérifie sa présence.
    const idx = countInputs(inputs);
    inputs.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`);
    filters.push(`[${idx}:a]atrim=duration=${totalSec.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
    audioLabel = 'aout';
  } else if (audioParts.length === 1) {
    audioLabel = audioParts[0] as string;
  } else {
    filters.push(
      `${audioParts.map((l) => `[${l}]`).join('')}amix=inputs=${audioParts.length}:` +
        `duration=first:dropout_transition=0:normalize=0[aout]`,
    );
    audioLabel = 'aout';
  }

  const encoding =
    plan.preset === 'final'
      ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-profile:v', 'high', '-level', '4.1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'];

  const args = [
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${currentLabel}]`,
    '-map', `[${audioLabel}]`,
    ...encoding,
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    '-t', totalSec.toFixed(3),
    plan.outputPath,
  ];

  return { args, expectedDurationMs, segments };
}

/** Compte les entrées déjà déclarées (chaque `-i` ouvre une entrée). */
function countInputs(inputs: string[]): number {
  return inputs.filter((token) => token === '-i').length;
}
