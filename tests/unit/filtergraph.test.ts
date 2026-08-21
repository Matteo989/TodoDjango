import { describe, expect, it } from 'vitest';
import {
  buildRenderCommand,
  compensateForTransitions,
  escapeFilterPath,
  totalOverlapMs,
  transitionDurationMs,
  type RenderPlan,
  type RenderScene,
} from '@/server/render/filtergraph';

function scene(overrides: Partial<RenderScene> = {}): RenderScene {
  return {
    durationMs: 4000,
    transition: 'cut',
    zoom: 1,
    source: { kind: 'placeholder', labelFile: '/tmp/label.txt' },
    ...overrides,
  };
}

function plan(overrides: Partial<RenderPlan> = {}): RenderPlan {
  return {
    outputPath: '/tmp/out.mp4',
    width: 1080,
    height: 1920,
    fps: 30,
    scenes: [scene(), scene(), scene()],
    musicVolume: 0.18,
    preset: 'final',
    fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ...overrides,
  };
}

function filterGraph(args: string[]): string {
  const index = args.indexOf('-filter_complex');
  return args[index + 1] ?? '';
}

describe('buildRenderCommand', () => {
  it('refuse un storyboard vide', () => {
    expect(() => buildRenderCommand(plan({ scenes: [] }))).toThrow(/aucune scène/i);
  });

  it('recadre toute source en 1080x1920 sans bandes noires', () => {
    // Les ardoises sont déjà générées au bon format par l'entrée lavfi; c'est
    // une source importée qui doit passer par le recadrage.
    const graph = filterGraph(
      buildRenderCommand(
        plan({ scenes: [scene({ source: { kind: 'video', path: '/tmp/paysage.mp4' } })] }),
      ).args,
    );
    expect(graph).toContain('scale=1080:1920:force_original_aspect_ratio=increase');
    expect(graph).toContain('crop=1080:1920');
    expect(graph).toContain('setsar=1');
  });

  it("additionne les durées quand toutes les scènes sont en coupe franche", () => {
    const built = buildRenderCommand(plan());
    expect(built.expectedDurationMs).toBe(12_000);
  });

  it('déduit le recouvrement de chaque fondu de la durée totale', () => {
    const built = buildRenderCommand(
      plan({
        scenes: [
          scene({ durationMs: 3000, transition: 'fade' }),
          scene({ durationMs: 4000, transition: 'fade' }),
          scene({ durationMs: 3000, transition: 'cut' }),
        ],
      }),
    );
    // 3000 + 4000 + 3000 - 500 - 500
    expect(built.expectedDurationMs).toBe(9000);
  });

  it('calcule des offsets xfade croissants et cohérents', () => {
    const graph = filterGraph(
      buildRenderCommand(
        plan({
          scenes: [
            scene({ durationMs: 3000, transition: 'fade' }),
            scene({ durationMs: 4000, transition: 'fade' }),
            scene({ durationMs: 3000, transition: 'cut' }),
          ],
        }),
      ).args,
    );
    expect(graph).toContain('offset=2.500');
    expect(graph).toContain('offset=6.000');
  });

  it('borne la transition à 30 % de la plus courte des deux scènes', () => {
    expect(transitionDurationMs(1000, 5000)).toBe(300);
    expect(transitionDurationMs(10_000, 8000)).toBe(500);
    expect(transitionDurationMs(0, 5000)).toBe(0);
  });

  it('concatène sans xfade quand toutes les transitions sont des coupes', () => {
    const graph = filterGraph(buildRenderCommand(plan()).args);
    expect(graph).toContain('concat=n=3:v=1:a=0');
    expect(graph).not.toContain('xfade');
  });

  it('ajoute toujours une piste audio, même sans voix ni musique', () => {
    const built = buildRenderCommand(plan());
    // anullsrc est une ENTRÉE lavfi, pas un filtre: elle vit dans l'argv.
    expect(built.args.join(' ')).toContain('anullsrc');
    expect(filterGraph(built.args)).toContain('[aout]');
    expect(built.args).toContain('aac');
  });

  it('mixe voix et musique quand les deux sont présentes', () => {
    const graph = filterGraph(
      buildRenderCommand(plan({ voicePath: '/tmp/v.mp3', musicPath: '/tmp/m.mp3' })).args,
    );
    expect(graph).toContain('[avoice]');
    expect(graph).toContain('[amusic]');
    expect(graph).toContain('amix=inputs=2');
  });

  it('boucle la musique pour couvrir toute la vidéo', () => {
    const built = buildRenderCommand(plan({ musicPath: '/tmp/m.mp3' }));
    expect(built.args).toContain('-stream_loop');
  });

  it('brûle les sous-titres via le filtre ass', () => {
    const graph = filterGraph(buildRenderCommand(plan({ subtitlePath: '/tmp/c.ass' })).args);
    expect(graph).toContain("ass='/tmp/c.ass'");
  });

  it('incruste le filigrane avant les sous-titres', () => {
    const graph = filterGraph(
      buildRenderCommand(plan({ watermarkPath: '/tmp/w.png', subtitlePath: '/tmp/c.ass' })).args,
    );
    expect(graph.indexOf('overlay=')).toBeLessThan(graph.indexOf('ass='));
  });

  it('anime les images fixes quand un zoom est demandé', () => {
    const graph = filterGraph(
      buildRenderCommand(
        plan({ scenes: [scene({ zoom: 1.15, source: { kind: 'image', path: '/tmp/a.jpg' } })] }),
      ).args,
    );
    expect(graph).toContain("crop=1080:1920:'(iw-ow)/2'");
  });

  it('prolonge une vidéo trop courte au lieu de laisser un trou', () => {
    const graph = filterGraph(
      buildRenderCommand(
        plan({ scenes: [scene({ source: { kind: 'video', path: '/tmp/a.mp4' } })] }),
      ).args,
    );
    expect(graph).toContain('tpad=stop_mode=clone');
    expect(graph).toContain('trim=duration=4.000');
  });

  it('choisit un preset plus rapide en brouillon', () => {
    expect(buildRenderCommand(plan({ preset: 'draft' })).args).toContain('veryfast');
    expect(buildRenderCommand(plan({ preset: 'final' })).args).toContain('medium');
  });

  it('termine par le chemin de sortie', () => {
    const args = buildRenderCommand(plan()).args;
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('numérote les entrées dans l’ordre où elles sont déclarées', () => {
    const graph = filterGraph(
      buildRenderCommand(plan({ voicePath: '/tmp/v.mp3', musicPath: '/tmp/m.mp3' })).args,
    );
    // 3 scènes → entrées 0,1,2 ; voix → 3 ; musique → 4.
    expect(graph).toContain('[3:a]');
    expect(graph).toContain('[4:a]');
  });
});

describe('escapeFilterPath', () => {
  it('échappe les caractères qui casseraient un argument de filtre', () => {
    expect(escapeFilterPath("C:\\vidéos\\l'export.ass")).toBe("C\\:\\\\vidéos\\\\l\\'export.ass");
  });
});

describe('compensateForTransitions', () => {
  it('rend exactement la durée cible malgré les fondus', () => {
    const scenes = [
      scene({ durationMs: 5000, transition: 'fade' }),
      scene({ durationMs: 5000, transition: 'fade' }),
      scene({ durationMs: 5000, transition: 'fade' }),
      scene({ durationMs: 5000, transition: 'cut' }),
    ];
    const compensated = compensateForTransitions(scenes, 20_000);
    const built = buildRenderCommand(plan({ scenes: compensated }));
    expect(built.expectedDurationMs).toBe(20_000);
  });

  it('ne touche à rien quand toutes les transitions sont des coupes', () => {
    const scenes = [scene({ durationMs: 4000 }), scene({ durationMs: 4000 })];
    expect(compensateForTransitions(scenes, 8000)).toEqual(scenes);
  });

  it('laisse une scène unique intacte', () => {
    const only = [scene({ durationMs: 7000, transition: 'fade' })];
    expect(compensateForTransitions(only, 7000)).toEqual(only);
  });

  it('compte le recouvrement de chaque fondu, pas des coupes', () => {
    expect(
      totalOverlapMs([
        scene({ durationMs: 4000, transition: 'fade' }),
        scene({ durationMs: 4000, transition: 'cut' }),
        scene({ durationMs: 4000, transition: 'fade' }),
      ]),
    ).toBe(500);
  });

  it('gère des durées de scènes inégales', () => {
    const scenes = [
      scene({ durationMs: 1200, transition: 'fade' }),
      scene({ durationMs: 9000, transition: 'fade' }),
      scene({ durationMs: 2500, transition: 'fade' }),
      scene({ durationMs: 6000, transition: 'cut' }),
    ];
    const built = buildRenderCommand(plan({ scenes: compensateForTransitions(scenes, 18_700) }));
    expect(built.expectedDurationMs).toBe(18_700);
  });
});
