import * as THREE from 'three';

/*
 * Browsers link WebGL programs in the background when KHR_parallel_shader_compile
 * is available, but three.js asks for the link result the first time it draws
 * with a program, and that query waits for the link on the main thread. A scene's
 * first frame therefore freezes the page for as long as its slowest shader takes
 * to link: for a scene lit by drei's <Environment>, that is the GGX pre-filter
 * three.js runs to turn the environment cube into a PMREM, about 0.4-0.7s on a
 * fast GPU with a cold shader cache.
 *
 * warmUpScene compiles every program the first frame needs, waits for the links
 * without blocking, and only then lets the caller draw. renderer.compileAsync()
 * cannot do this on its own: the PMREM is generated (and drawn) synchronously
 * inside it, on programs that have not linked yet.
 */

/** Private PMREMGenerator members this reads; checked before use. */
type PmremInternals = {
  _setSize: (cubeSize: number) => void;
  _allocateTargets: () => THREE.WebGLRenderTarget;
  _ggxMaterial: THREE.ShaderMaterial | null;
  _cubemapMaterial: THREE.ShaderMaterial | null;
  _equirectMaterial: THREE.ShaderMaterial | null;
};

type Linkable = { isReady(): boolean };

const POLL_MS = 16;
// A lost context never reports a link, so the wait gives up and the first frame
// links whatever is left on the main thread.
const GIVE_UP_MS = 10_000;

const flatCamera = new THREE.OrthographicCamera();

function programOf(gl: THREE.WebGLRenderer, material: THREE.Material): Linkable | undefined {
  return (gl.properties.get(material) as { currentProgram?: Linkable } | undefined)?.currentProgram;
}

/** Resolves once every material's program has linked, polling without a blocking query. */
function linked(gl: THREE.WebGLRenderer, materials: Iterable<THREE.Material>, signal?: AbortSignal): Promise<void> {
  const pending = new Set(materials);
  const start = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (signal?.aborted || gl.getContext().isContextLost() || performance.now() - start > GIVE_UP_MS) {
        resolve();
        return;
      }
      for (const material of pending) {
        const program = programOf(gl, material);
        if (!program || program.isReady()) pending.delete(material);
      }
      if (pending.size === 0) resolve();
      else window.setTimeout(check, POLL_MS);
    };
    check();
  });
}

type Source = { kind: 'cube' | 'equirect'; size: number };

/** The environment three.js will pre-filter into a PMREM, sized as its generator sizes it. */
function pmremSource(environment: THREE.Texture | null): Source | null {
  if (!environment) return null;
  const { mapping } = environment;
  if (mapping === THREE.CubeReflectionMapping || mapping === THREE.CubeRefractionMapping) {
    const face = (environment.image as { width?: number }[] | undefined)?.[0];
    return face?.width ? { kind: 'cube', size: face.width } : null;
  }
  if (mapping === THREE.EquirectangularReflectionMapping || mapping === THREE.EquirectangularRefractionMapping) {
    const width = (environment.image as { width?: number } | undefined)?.width;
    return width ? { kind: 'equirect', size: width / 4 } : null;
  }
  return null;
}

/**
 * Starts compiling the programs PMREMGenerator uses to pre-filter `source`.
 * Programs are cached by their source and render state, so the generator three.js
 * creates for the scene later picks up these same programs. They must be compiled
 * with a render target bound, as PMREM draws into one (no tone mapping, linear
 * output), or they would be keyed differently. Returns null when the generator's
 * internals are not the ones this expects (it relies on private members, checked
 * here); the PMREM programs then link when first drawn.
 */
function precompilePmrem(gl: THREE.WebGLRenderer, source: Source) {
  const generator = new THREE.PMREMGenerator(gl);
  const pmrem = generator as unknown as Partial<PmremInternals>;
  if (typeof pmrem._setSize !== 'function' || typeof pmrem._allocateTargets !== 'function') {
    generator.dispose();
    return null;
  }
  pmrem._setSize(source.size);
  const cubeUv = pmrem._allocateTargets();
  const ggx = pmrem._ggxMaterial;
  if (!ggx) {
    cubeUv.dispose();
    generator.dispose();
    return null;
  }
  if (source.kind === 'cube') generator.compileCubemapShader();
  else generator.compileEquirectangularShader();
  gl.compile(new THREE.Mesh(new THREE.BufferGeometry(), ggx), flatCamera);
  const materials = [ggx, pmrem._cubemapMaterial, pmrem._equirectMaterial].filter((m): m is THREE.ShaderMaterial =>
    Boolean(m),
  );
  return {
    materials,
    // Only after the real PMREM pass has acquired the programs: disposing the last
    // material that uses a program deletes it.
    dispose() {
      cubeUv.dispose();
      generator.dispose();
    },
  };
}

type WarmUpOptions = {
  /** The scene is drawn into a render target (post-processing), not the canvas. */
  offscreen: boolean;
  signal?: AbortSignal;
};

/**
 * Compiles everything `scene` needs for its first frame, including the pre-filtered
 * environment, and resolves once the programs have linked. Call it before the
 * first render (with the frameloop held) and after the scene's environment is set.
 */
export async function warmUpScene(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  { offscreen, signal }: WarmUpOptions,
): Promise<void> {
  // Without the extension every link blocks wherever it happens; nothing to gain.
  if (!gl.extensions.has('KHR_parallel_shader_compile')) return;

  const previous = gl.getRenderTarget();
  // Any bound target keys programs the way PMREM's and the composer's targets do.
  const probe = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  let pmrem: ReturnType<typeof precompilePmrem> = null;
  try {
    const source = pmremSource(scene.environment);
    if (source) {
      gl.setRenderTarget(probe);
      pmrem = precompilePmrem(gl, source);
      gl.setRenderTarget(previous);
      if (pmrem) await linked(gl, pmrem.materials, signal);
    }
    if (signal?.aborted) return;

    gl.setRenderTarget(offscreen ? probe : previous);
    // Generates the PMREM too, on the programs that have just linked.
    const materials = gl.compile(scene, camera);
    gl.setRenderTarget(previous);
    await linked(gl, materials, signal);
  } finally {
    gl.setRenderTarget(previous);
    pmrem?.dispose();
    probe.dispose();
  }
}
