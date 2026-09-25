'use client';

import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Float, Lightformer, useGLTF } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useTheme } from '@/contexts/ThemeContext';
import { useFrameloop } from '@/hooks/useFrameloop';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { pointer, usePointerTracking } from '@/lib/pointerStore';

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
        <primitive object={scene} scale={1.15} position={[0, -0.1, 0]} />
      </Float>
    </group>
  );
}

/**
 * The holographic envelope beside the contact form. Mounted only by Deferred3D
 * (id 'contact'), so the model and three.js load only on devices allowed heavy
 * 3D and only near the section. It renders only while on screen and the tab is
 * visible, and skips bloom on lite devices and in the light theme.
 */
export function ContactCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameloop = useFrameloop(wrapRef, '0px');
  const { lite } = useMotionPrefs();
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';
  usePointerTracking();

  return (
    <div ref={wrapRef} aria-hidden="true" data-contact-canvas="" className="size-full">
      <Canvas
        frameloop={frameloop}
        camera={{ position: [0, 0.2, 5.5], fov: 38 }}
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: isLight ? 0.95 : 0.7,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
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
        </Suspense>

        {!lite && !isLight ? (
          <EffectComposer>
            <Bloom intensity={0.45} luminanceThreshold={0.5} luminanceSmoothing={0.9} mipmapBlur />
          </EffectComposer>
        ) : null}
      </Canvas>
    </div>
  );
}

export default ContactCanvas;
