import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFFmpeg } from '@/server/render/ffmpeg';
import { escapeFilterPath } from '@/server/render/filtergraph';
import type { VideoAsset, VideoPrompt, VideoProvider } from './types';

const FALLBACK_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

/**
 * Génération vidéo de repli.
 *
 * Elle ne génère pas d'images: elle rend une ardoise portant le prompt, à la
 * bonne durée et au bon format. Cela permet de valider un storyboard complet et
 * un montage sans dépendre d'un fournisseur payant, tout en restant lisible sur
 * le rendu final — personne ne peut confondre cela avec un plan généré.
 */
export class MockVideoProvider implements VideoProvider {
  readonly id = 'mock';
  readonly isLive = false;

  async generateVideo(input: VideoPrompt): Promise<VideoAsset> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iavid-video-'));
    const textFile = path.join(dir, 'prompt.txt');
    const output = path.join(dir, 'scene.mp4');
    const seconds = Math.max(0.5, input.durationMs / 1000);

    try {
      await writeFile(
        textFile,
        wrapText(`[PLAN NON GÉNÉRÉ]\n${input.prompt}`, 34),
        'utf-8',
      );

      await runFFmpeg([
        '-f', 'lavfi',
        '-i', `color=c=0x0f172a:s=${input.width}x${input.height}:r=${input.fps}:d=${seconds.toFixed(3)}`,
        '-vf',
        `drawtext=fontfile='${escapeFilterPath(FALLBACK_FONT)}':` +
          `textfile='${escapeFilterPath(textFile)}':fontcolor=0x94a3b8:fontsize=44:` +
          `line_spacing=14:x=(w-text_w)/2:y=(h-text_h)/2,format=yuv420p`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-t', seconds.toFixed(3),
        output,
      ]);

      return {
        buffer: await readFile(output),
        mimeType: 'video/mp4',
        durationMs: input.durationMs,
        width: input.width,
        height: input.height,
        costCents: 0,
        provider: this.id,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function wrapText(text: string, maxChars: number): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if (!current) current = word;
        else if (current.length + 1 + word.length <= maxChars) current = `${current} ${word}`;
        else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.length > 0 ? lines : [''];
    })
    .join('\n');
}
