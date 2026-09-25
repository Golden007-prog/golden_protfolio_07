'use client';

import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber';
import { Environment, Lightformer, PerformanceMonitor, useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { BloomEffect } from 'postprocessing';
import * as THREE from 'three';
import { useTheme } from '@/contexts/ThemeContext';
import { useDeviceCapability } from '@/hooks/useDeviceCapability';
import { useFrameloop } from '@/hooks/useFrameloop';
import { isDialogOpen, subscribeDialogPresence } from '@/lib/dialogPresence';
import { useRenderCount } from '@/lib/devRenderCount';
import { heroScroll } from '@/lib/heroScrollStore';
import { pointer } from '@/lib/pointerStore';
import { prewarmPmrem, whenProgramsLinked, withRenderTarget } from './shaderWarmup';

const MODEL_URL = '/models/hero-character.glb';
const BLOOM_INTENSITY = 0.5;
/** Cube size of the baked environment; the PMREM warm-up must match it to share programs. */
const ENV_RESOLUTION = 512;
/** Past this the model mounts or shows anyway, and a slow link finishes on the main thread. */
const LINK_TIMEOUT_MS = 4000;
// The framing was tuned on a ~0.9 (w/h) desktop column; narrower canvases zoom out to keep the bust whole.
const FRAMED_ASPECT = 0.9;

const CAMERA = { position: [0.1, 0.15, 5.1] as [number, number, number], fov: 38 };
// EffectComposer switches the renderer to NoToneMapping while it is mounted, so
// the same setting here keeps the look unchanged when the performance tier drops it.
const GL = {
  antialias: true,
  toneMapping: THREE.NoToneMapping,
  outputColorSpace: THREE.SRGBColorSpace,
};

/**
 * Render budget steps, taken by PerformanceMonitor and never taken back:
 * 0 full quality, 1 device-pixel ratio capped at 1.25, 2 no post-processing.
 */
type Tier = 0 | 1 | 2;

// One element for the life of the module: drei's Environment re-bakes its cube
// camera (6 render passes) whenever its children change identity.
const LIGHTFORMERS = (
  <group rotation={[-Math.PI / 4, 0, 0]}>
    <Lightformer form="rect" intensity={3} position={[0, 5, -2]} scale={[12, 2, 1]} rotation-x={Math.PI / 2} color="#ffffff" />
    <Lightformer form="rect" intensity={2} position={[6, 1, 0]} scale={[1, 8, 1]} rotation-y={-Math.PI / 2} color="#ffffff" />
    <Lightformer form="rect" intensity={1} position={[-6, 1, 0]} scale={[1, 8, 1]} rotation-y={Math.PI / 2} color="#aabbcc" />
    <Lightformer form="circle" color="#ff3300" intensity={6} position={[-3, 2, -4]} scale={3} />
    <Lightformer form="circle" color="#ffffff" intensity={8} position={[1, 4, 2]} scale={0.5} />
  </group>
);

/**
 * Renders its children once three's PMREM programs have linked in parallel. Without
 * this, the model's first frame linked the GGX filter synchronously while baking the
 * environment: one 0.4-0.7 s main-thread task on a cold desktop GPU, landing on the
 * intro. The GLB keeps downloading meanwhile (HeroCanvasImpl preloads it).
 */
function PmremWarmupGate({ children }: { children: ReactNode }) {
  const gl = useThree((s) => s.gl);
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const warmup = prewarmPmrem(gl, ENV_RESOLUTION, LINK_TIMEOUT_MS);
    let live = true;
    void warmup.ready.then(() => {
      if (live) setWarm(true);
    });
    return () => {
      live = false;
      warmup.dispose();
    };
  }, [gl]);
  return warm ? children : null;
}

function CyborgModel({ onReady, postprocessed }: { onReady?: () => void; postprocessed: boolean }) {
  const { scene } = useGLTF(MODEL_URL);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const root = useThree((s) => s.scene);
  const group = useRef<THREE.Group>(null);
  const motion = useRef({ yaw: 0, pitch: 0, x: 0, y: 0 });
  const [linked, setLinked] = useState(false);

  // Once per loaded scene, not per render: needsUpdate recompiles the shader.
  useLayoutEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const m of materials) {
        if (!m) continue;
        m.envMapIntensity = 4.0;
        m.roughness = 0.03;
        m.metalness = 1.0;
        if (m.emissive && (m.emissive.r > 0.1 || m.color.r > 0.4)) {
          m.emissiveIntensity = 5.0;
          m.toneMapped = false;
        }
        m.needsUpdate = true;
      }
    });
  }, [scene]);

  // The group stays hidden (render() skips it) while its programs link off the main
  // thread. compile() takes hidden objects too, and bakes the environment's PMREM
  // now, on the programs PmremWarmupGate linked. Runs after the material tweaks above.
  // With post-processing the model draws into the composer's buffer, not the canvas,
  // and the program has to be compiled for that target to be the one used.
  useEffect(() => {
    const compile = () => gl.compile(scene, camera, root);
    const wait = whenProgramsLinked(gl, postprocessed ? withRenderTarget(gl, compile) : compile(), LINK_TIMEOUT_MS);
    let live = true;
    void wait.ready.then(() => {
      if (live) setLinked(true);
    });
    return () => {
      live = false;
      wait.cancel();
    };
  }, [gl, scene, camera, root, postprocessed]);

  // Linked and visible: the next frame has the model on screen.
  useEffect(() => {
    if (!linked || !onReady) return;
    const id = requestAnimationFrame(() => onReady());
    return () => cancelAnimationFrame(id);
  }, [linked, onReady]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(delta, 0.1);
    const mx = pointer.active ? pointer.nx : 0;
    const my = pointer.active ? pointer.ny : 0;
    const sp = heroScroll.progress;
    const m = motion.current;
    m.yaw = THREE.MathUtils.damp(m.yaw, mx * 0.7 + sp * 0.6, 3.7, dt);
    m.pitch = THREE.MathUtils.damp(m.pitch, -my * 0.45 + sp * 0.18, 3.7, dt);
    m.x = THREE.MathUtils.damp(m.x, -mx * 0.12, 3.1, dt);
    m.y = THREE.MathUtils.damp(m.y, -my * 0.08 - sp * 0.25, 3.1, dt);
    g.rotation.set(m.pitch, m.yaw, 0);
    g.position.set(m.x, m.y + Math.sin(state.clock.elapsedTime * 0.6) * 0.02, 0);
    g.scale.setScalar(1 - sp * 0.12);
  });

  return (
    <group ref={group} visible={linked}>
      <primitive object={scene} scale={1.4} position={[0, -0.2, 0]} />
    </group>
  );
}

/** Keeps the model inside narrow canvases (phones, the tablet column) instead of cropping it. */
function FitCamera() {
  const get = useThree((s) => s.get);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useLayoutEffect(() => {
    const { camera, invalidate } = get();
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.zoom = Math.min(1, aspect / FRAMED_ASPECT);
    camera.updateProjectionMatrix();
    invalidate();
  }, [get, aspect]);
  return null;
}

function Effects({ light, multisampling }: { light: boolean; multisampling: number }) {
  const bloom = useRef<BloomEffect | null>(null);
  // onUpdate hands over the effect instance; a ref prop would be serialised into
  // the wrapper's args key and could throw on the effect's circular references.
  const captureBloom = useCallback((effect: BloomEffect) => {
    bloom.current = effect;
  }, []);

  useFrame(() => {
    const b = bloom.current;
    if (b) b.intensity = BLOOM_INTENSITY * heroScroll.bloom;
  });

  return (
    <EffectComposer multisampling={multisampling}>
      <Bloom onUpdate={captureBloom} luminanceThreshold={0.1} luminanceSmoothing={0.9} intensity={BLOOM_INTENSITY} mipmapBlur />
      <Vignette eskil={false} offset={0.1} darkness={light ? 0.25 : 0.85} />
    </EffectComposer>
  );
}

type Props = {
  /** Called once the model is on screen. */
  onReady?: () => void;
};

function HeroCanvasImpl({ onReady }: Props) {
  useRenderCount('HeroCanvas');
  const hostRef = useRef<HTMLDivElement>(null);
  const frameloop = useFrameloop(hostRef);
  // Any open dialog covers the hero (full-screen, or a 75% blurred backdrop): stop
  // drawing under it, which also spares the backdrop blur a new frame every tick.
  const underDialog = useSyncExternalStore(subscribeDialogPresence, isDialogOpen, () => false);
  const { isTouch } = useDeviceCapability();
  const { resolvedTheme } = useTheme();
  const [tier, setTier] = useState<Tier>(0);

  const maxDpr = isTouch ? 1.5 : 2;
  const dpr = useMemo<[number, number]>(() => [1, tier === 0 ? maxDpr : Math.min(1.25, maxDpr)], [tier, maxDpr]);

  // Starts the GLB fetch as soon as this chunk renders, which only happens once
  // Deferred3D has allowed the canvas (never under reduced motion or Save-Data).
  useLayoutEffect(() => {
    useGLTF.preload(MODEL_URL);
  }, []);

  // hero.css fades the host in on data-ready, so the model never pops in.
  const ready = useCallback(() => {
    hostRef.current?.setAttribute('data-ready', '');
    onReady?.();
  }, [onReady]);
  const decline = useCallback(() => setTier((t) => (t === 0 ? 1 : 2)), []);
  const fallback = useCallback(() => setTier(2), []);
  const created = useCallback(({ gl }: RootState) => {
    const host = hostRef.current;
    if (host) host.dataset.shadowMap = gl.shadowMap.enabled ? 'on' : 'off';
  }, []);

  return (
    <div ref={hostRef} className="absolute inset-0" data-hero-canvas="" data-tier={tier}>
      <Canvas frameloop={underDialog ? 'never' : frameloop} dpr={dpr} camera={CAMERA} gl={GL} onCreated={created}>
        <PerformanceMonitor flipflops={3} onDecline={decline} onFallback={fallback} />
        <FitCamera />
        <Environment resolution={ENV_RESOLUTION}>{LIGHTFORMERS}</Environment>

        <ambientLight intensity={0.05} />
        <directionalLight position={[3, 5, 2]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[-4, 2, -3]} intensity={2.5} color="#ff4400" />
        <pointLight position={[0, -2, 2]} intensity={0.2} color="#7C3AED" />

        <PmremWarmupGate>
          <Suspense fallback={null}>
            <CyborgModel onReady={ready} postprocessed={tier < 2} />
          </Suspense>
        </PmremWarmupGate>

        {tier < 2 ? <Effects light={resolvedTheme === 'light'} multisampling={isTouch ? 2 : 8} /> : null}
      </Canvas>
    </div>
  );
}

/** The hero's WebGL scene. Memoised: the hero's own state never reaches the canvas. */
export const HeroCanvas = memo(HeroCanvasImpl);

export default HeroCanvas;
