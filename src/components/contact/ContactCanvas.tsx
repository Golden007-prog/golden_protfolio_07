'use client';

import { Suspense, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Float, Lightformer, useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useTheme } from '@/contexts/ThemeContext';
import { useFrameloop } from '@/hooks/useFrameloop';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { pointer, usePointerTracking } from '@/lib/pointerStore';
import { warmUpScene } from '@/lib/shaderWarmUp';
import { ENVELOPE_CAMERA, ENVELOPE_SCALE, envelopeZoom } from './envelopeFit';

export const ENVELOPE_URL = '/models/holo-envelope.glb';

function Envelope() {
  // Meshopt-compressed, no Draco: skipping the Draco loader avoids its CDN decoder.
  const { scene } = useGLTF(ENVELOPE_URL, false, true);
  const group = useRef<THREE.Group>(null);

  // Eases toward the shared pointer (one app-wide listener); level again when it leaves.
  useFrame((_state, delta) => {
    const g = group.current;
    if (!g) return;
    const k = Math.min(1, delta * 6);
    const ty = pointer.active ? pointer.nx * 0.55 : 0;
    const tx = pointer.active ? -pointer.ny * 0.35 : 0;
    g.rotation.y += (ty - g.rotation.y) * k;
    g.rotation.x += (tx - g.rotation.x) * k;
  });

  return (
    <group ref={group}>
      <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.45}>
        <primitive object={scene} scale={ENVELOPE_SCALE} position={[0, -0.1, 0]} />
      </Float>
    </group>
  );
}

/** Zooms out on a canvas narrower than the envelope's framing, so its sides stay in view. */
function FitCamera() {
  const get = useThree((s) => s.get);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useLayoutEffect(() => {
    const { camera, invalidate } = get();
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    camera.zoom = envelopeZoom(aspect);
    camera.updateProjectionMatrix();
    invalidate();
  }, [get, aspect]);
  return null;
}

/**
 * Compiles the scene's shaders in the background once the model and environment
 * are in, then reports ready. Until then the frameloop is held, because the first
 * frame would otherwise link them on the main thread and freeze the scroll into
 * Contact for about half a second.
 */
function WarmUp({ offscreen, onReady }: { offscreen: boolean; onReady: () => void }) {
  const get = useThree((s) => s.get);
  const run = useEffectEvent((signal: AbortSignal) => {
    const { gl, scene, camera } = get();
    warmUpScene(gl, scene, camera, { offscreen, signal })
      .catch(() => {})
      .finally(() => {
        if (!signal.aborted) onReady();
      });
  });
  useEffect(() => {
    const controller = new AbortController();
    run(controller.signal);
    return () => controller.abort();
  }, []);
  return null;
}

/**
 * The holographic envelope beside the contact form. Mounted only by Deferred3D
 * (id 'contact'), so the model and three.js load only on devices allowed heavy
 * 3D and only near the section. Its first frame waits for the shaders to compile
 * (it fades in then); after that it renders only while on screen and the tab is
 * visible, and skips bloom on lite devices and in the light theme.
 */
export function ContactCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const visibleLoop = useFrameloop(wrapRef, '0px');
  const [ready, setReady] = useState(false);
  const { lite } = useMotionPrefs();
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';
  const bloom = !lite && !isLight;
  usePointerTracking();

  // Deferred3D mounts this ahead of the section, so the fetch starts before the
  // canvas has even been measured.
  useLayoutEffect(() => {
    useGLTF.preload(ENVELOPE_URL, false, true);
  }, []);

  return (
    <div aria-hidden="true" className="flex size-full items-center">
      {/* A 3:4 box rather than the whole column, which stretches to the form's
          height: the envelope needs no more, and the canvas draws fewer pixels. */}
      <div
        ref={wrapRef}
        data-contact-canvas=""
        data-ready={ready ? '' : undefined}
        className="aspect-[3/4] max-h-full w-full opacity-0 transition-opacity duration-700 data-ready:opacity-100"
      >
        <Canvas
          frameloop={ready ? visibleLoop : 'never'}
          camera={ENVELOPE_CAMERA}
          dpr={[1, 1.75]}
          // Measure without waiting for the page to stop scrolling, so the model can
          // load and compile while the section is still below the fold.
          resize={{ scroll: false }}
          gl={{
            antialias: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: isLight ? 0.95 : 0.7,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
        >
          <FitCamera />
          <ambientLight intensity={isLight ? 0.6 : 0.22} color="#ffffff" />
          <directionalLight position={[4, 5, 4]} intensity={isLight ? 0.9 : 1.1} color="#ffffff" />
          <pointLight position={[-4, 3, -2]} intensity={isLight ? 0.55 : 1.2} color={isLight ? '#B8A4E8' : '#A855F7'} distance={12} decay={2} />
          <pointLight position={[3, -2, 3]} intensity={isLight ? 0.35 : 0.7} color={isLight ? '#A8D4DC' : '#22D3EE'} distance={10} decay={2} />
          <pointLight position={[0, 0, 4]} intensity={0.35} color="#ffffff" distance={8} decay={2} />

          <Suspense fallback={null}>
            <Envelope />
            <Environment resolution={256}>
              <Lightformer intensity={2} rotation-x={Math.PI / 2} position={[0, 4, -6]} scale={[10, 10, 1]} />
              <Lightformer intensity={1.2} rotation-y={Math.PI / 2} position={[-5, 1, -1]} scale={[10, 4, 1]} color="#22D3EE" />
              <Lightformer intensity={1.2} rotation-y={-Math.PI / 2} position={[5, 1, -1]} scale={[10, 4, 1]} color="#A855F7" />
            </Environment>
            <WarmUp offscreen={bloom} onReady={() => setReady(true)} />
          </Suspense>

          {bloom ? (
            <EffectComposer>
              <Bloom intensity={0.45} luminanceThreshold={0.5} luminanceSmoothing={0.9} mipmapBlur />
            </EffectComposer>
          ) : null}
        </Canvas>
      </div>
    </div>
  );
}

export default ContactCanvas;
