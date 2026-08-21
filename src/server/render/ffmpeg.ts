import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { env } from '@/lib/env';

const execFileAsync = promisify(execFile);

export class FFmpegError extends Error {
  readonly args: string[];
  readonly stderr: string;

  constructor(message: string, args: string[], stderr: string) {
    super(message);
    this.name = 'FFmpegError';
    this.args = args;
    // On conserve la fin de stderr: c'est là que FFmpeg écrit la cause réelle.
    this.stderr = stderr.slice(-4000);
  }
}

export interface MediaInfo {
  durationMs: number;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  sizeBytes: number;
  format: string;
}

interface FFProbeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  duration?: string;
}

interface FFProbeOutput {
  streams?: FFProbeStream[];
  format?: { duration?: string; size?: string; format_name?: string };
}

function parseFps(rate: string | undefined): number | null {
  if (!rate) return null;
  const [num, den] = rate.split('/');
  const n = Number(num);
  const d = Number(den ?? 1);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return Math.round((n / d) * 100) / 100;
}

/** Disponibilité des binaires: vérifiée au démarrage et affichée dans Settings (R1). */
export async function checkFFmpegAvailable(): Promise<{
  ffmpeg: { available: boolean; version?: string };
  ffprobe: { available: boolean; version?: string };
}> {
  const e = env();
  const probeOne = async (bin: string) => {
    try {
      const { stdout } = await execFileAsync(bin, ['-version'], { timeout: 10_000 });
      return { available: true, version: stdout.split('\n')[0]?.trim() };
    } catch {
      return { available: false };
    }
  };
  const [ffmpeg, ffprobe] = await Promise.all([probeOne(e.FFMPEG_PATH), probeOne(e.FFPROBE_PATH)]);
  return { ffmpeg, ffprobe };
}

export async function probeMedia(filePath: string): Promise<MediaInfo> {
  const e = env();
  const args = [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(e.FFPROBE_PATH, args, { maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    const err = error as { stderr?: string; message: string };
    throw new FFmpegError(`ffprobe a échoué sur ${filePath}`, args, err.stderr ?? err.message);
  }

  const parsed = JSON.parse(stdout) as FFProbeOutput;
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  const durationSec = Number(parsed.format?.duration ?? video?.duration ?? audio?.duration ?? 0);

  return {
    durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : 0,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps: parseFps(video?.r_frame_rate),
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    sizeBytes: Number(parsed.format?.size ?? 0),
    format: parsed.format?.format_name ?? 'unknown',
  };
}

export interface RunOptions {
  /** Durée totale attendue, pour convertir la progression FFmpeg en pourcentage. */
  totalDurationMs?: number;
  onProgress?: (percent: number) => void;
  timeoutMs?: number;
}

/**
 * Exécute FFmpeg en streamant stderr pour publier une progression.
 * On passe par spawn plutôt qu'execFile: un rendu long produit beaucoup de
 * stderr et on veut la progression en temps réel, pas à la fin.
 */
export function runFFmpeg(args: string[], options: RunOptions = {}): Promise<{ stderr: string }> {
  const e = env();
  return new Promise((resolve, reject) => {
    const child = spawn(e.FFMPEG_PATH, ['-hide_banner', '-nostdin', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    let settled = false;

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : null;

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Borne la mémoire sur un rendu long tout en gardant la queue utile.
      stderr = (stderr + text).slice(-64_000);

      if (options.onProgress && options.totalDurationMs) {
        const match = /time=(\d+):(\d+):(\d+)\.(\d+)/.exec(text);
        if (match) {
          const [, h, m, s, cs] = match;
          const elapsedMs =
            Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(cs) * 10;
          const percent = Math.min(99, Math.round((elapsedMs / options.totalDurationMs) * 100));
          options.onProgress(percent);
        }
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(new FFmpegError(`Impossible de lancer ${e.FFMPEG_PATH}: ${error.message}`, args, stderr));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve({ stderr });
      } else {
        reject(new FFmpegError(`FFmpeg s'est terminé avec le code ${code}`, args, stderr));
      }
    });
  });
}

/** Extrait une miniature. `atMs` est borné à la durée réelle du média. */
export async function extractThumbnail(
  inputPath: string,
  outputPath: string,
  atMs = 1000,
): Promise<void> {
  await runFFmpeg([
    '-ss', (Math.max(0, atMs) / 1000).toFixed(3),
    '-i', inputPath,
    '-frames:v', '1',
    '-vf', 'scale=540:-2:flags=lanczos',
    '-q:v', '3',
    outputPath,
  ]);
}

/** Génère un WAV silencieux ou un ton de test — utilisé par le provider voix mock. */
export async function synthesizePlaceholderAudio(
  outputPath: string,
  durationMs: number,
  format: 'mp3' | 'wav',
): Promise<void> {
  const seconds = Math.max(0.1, durationMs / 1000);
  const codec = format === 'mp3' ? ['-codec:a', 'libmp3lame', '-b:a', '128k'] : ['-codec:a', 'pcm_s16le'];
  await runFFmpeg([
    '-f', 'lavfi',
    '-i', `anullsrc=channel_layout=mono:sample_rate=44100`,
    '-t', seconds.toFixed(3),
    ...codec,
    outputPath,
  ]);
}
