import * as THREE from 'three';

const POLL_MS = 16;

export type Warmup = {
  /** Settles once the programs report linked, or at the deadline; never after cancel. */
  ready: Promise<void>;
  cancel: () => void;
};

type Linkable = { isReady?: () => boolean };

/**
 * Waits for the programs behind `materials` (compiled already, e.g. by
 * renderer.compile) to finish linking without blocking: with
 * KHR_parallel_shader_compile, isReady() asks the driver instead of waiting on it.
 * Unlike three's compileAsync it stops at a deadline and on cancel, so a lost
 * context (whose programs never report ready) cannot leave a timer spinning.
 */
export function whenProgramsLinked(
  renderer: THREE.WebGLRenderer,
  materials: Iterable<THREE.Material>,
  timeoutMs: number,
): Warmup {
  const pending = new Set(materials);
  const deadline = performance.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const check = () => {
    timer = undefined;
    for (const material of pending) {
      const program = (renderer.properties.get(material) as { currentProgram?: Linkable }).currentProgram;
      if (!program || typeof program.isReady !== 'function' || program.isReady()) pending.delete(material);
    }
    if (pending.size === 0 || performance.now() >= deadline || renderer.getContext().isContextLost()) {
      settle();
      return;
    }
    timer = setTimeout(check, POLL_MS);
  };
  check();

  return {
    ready,
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      settle = () => {};
    },
  };
}

/**
 * Runs `fn` with a 1x1 render target bound, then restores the previous target. A
 * program's cache key records whether it draws to the canvas (the renderer's sRGB
 * output) or to a render target (linear), so a precompile has to match where the
 * real draw lands, such as an EffectComposer's input buffer or a PMREM pass.
 */
export function withRenderTarget<T>(renderer: THREE.WebGLRenderer, fn: () => T): T {
  const probe = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  const target = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const mip = renderer.getActiveMipmapLevel();
  try {
    renderer.setRenderTarget(probe);
    return fn();
  } finally {
    renderer.setRenderTarget(target, face, mip);
    probe.dispose();
  }
}

/** The PMREMGenerator members this relies on; checked at runtime, since they are private. */
type PmremInternals = {
  _setSize: (cubeSize: number) => void;
  _allocateTargets: () => THREE.WebGLRenderTarget;
  _ggxMaterial: THREE.ShaderMaterial | null;
  _cubemapMaterial: THREE.ShaderMaterial | null;
};

export type PmremWarmup = Warmup & {
  /** Releases the warm-up's own references; the shared programs live on in three's program cache. */
  dispose: () => void;
};

/**
 * Starts linking the two programs three's PMREMGenerator uses to bake a cube
 * environment of `cubeSize` (the cube-to-cubeUV copy and the 256-sample GGX filter)
 * on the driver's worker threads. The renderer then finds them in its program cache
 * when the first PBR material meets the environment; linked cold, the GGX filter
 * alone blocked the main thread for about 0.4 s on ANGLE/D3D11.
 *
 * The programs are compiled against a render target, as the bake draws, so they
 * carry the same cache key. Nothing is drawn and the generator's own large targets
 * are never bound, so they take no GPU memory. Keep the warm-up until the real bake
 * has run: dispose releases this generator's hold on the programs, and a program
 * nobody else holds is deleted.
 * If three's internals change shape, `ready` resolves at once and nothing is
 * prewarmed (the bake then links synchronously, as it would have anyway).
 */
export function prewarmPmrem(renderer: THREE.WebGLRenderer, cubeSize: number, timeoutMs: number): PmremWarmup {
  const generator = new THREE.PMREMGenerator(renderer);
  const internals = generator as unknown as Partial<PmremInternals>;
  const cold: PmremWarmup = { ready: Promise.resolve(), cancel: () => {}, dispose: () => generator.dispose() };
  if (typeof internals._setSize !== 'function' || typeof internals._allocateTargets !== 'function') return cold;

  internals._setSize(cubeSize);
  // Creates the GGX material sized for this cube; the returned target is never bound.
  internals._allocateTargets().dispose();
  const ggx = internals._ggxMaterial;
  if (!ggx) return cold;

  const geometry = new THREE.BufferGeometry();
  withRenderTarget(renderer, () => {
    generator.compileCubemapShader();
    renderer.compile(new THREE.Mesh(geometry, ggx), new THREE.OrthographicCamera());
  });
  geometry.dispose();

  const materials = [ggx, internals._cubemapMaterial].filter((m): m is THREE.ShaderMaterial => !!m);
  const wait = whenProgramsLinked(renderer, materials, timeoutMs);
  return {
    ...wait,
    dispose: () => {
      wait.cancel();
      generator.dispose();
    },
  };
}
