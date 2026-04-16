import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Environment, useGLTF } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useTheme } from '../../contexts/ThemeContext';

const MODEL_URL = `${import.meta.env.BASE_URL}models/holo-envelope.glb`;

const globalMouse = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    globalMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    globalMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });
}

function Envelope() {
  const { scene } = useGLTF(MODEL_URL);
  const group = useRef<THREE.Group>(null);
  const currentRot = useRef({ x: 0, y: 0 });

  useFrame((_s, delta) => {
    if (!group.current) return;
    const targetY = globalMouse.x * 0.55;
    const targetX = -(globalMouse.y * 0.35);
    const k = Math.min(1, delta * 6);

    currentRot.current.y += (targetY - currentRot.current.y) * k;
    currentRot.current.x += (targetX - currentRot.current.x) * k;

    group.current.rotation.y = currentRot.current.y;
    group.current.rotation.x = currentRot.current.x;
  });

  return (
    <group ref={group}>
      <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.45}>
        <primitive object={scene} scale={1.15} position={[0, -0.1, 0]} />
      </Float>
    </group>
  );
}
useGLTF.preload(MODEL_URL);

export function ContactCanvas() {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';
  return (
    <Canvas
      camera={{ position: [0, 0.2, 5.5], fov: 38 }}
      dpr={[1, 2]}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: isLight ? 0.55 : 0.7,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
    >
      <ambientLight intensity={isLight ? 0.35 : 0.22} color="#ffffff" />
      <directionalLight position={[4, 5, 4]} intensity={isLight ? 0.9 : 1.1} color="#ffffff" />
      <pointLight
        position={[-4, 3, -2]}
        intensity={isLight ? 0.55 : 1.2}
        color={isLight ? '#B8A4E8' : '#A855F7'}
        distance={12}
        decay={2}
      />
      <pointLight
        position={[3, -2, 3]}
        intensity={isLight ? 0.35 : 0.7}
        color={isLight ? '#A8D4DC' : '#22D3EE'}
        distance={10}
        decay={2}
      />
      <pointLight position={[0, 0, 4]} intensity={0.35} color="#ffffff" distance={8} decay={2} />

      <Suspense fallback={null}>
        <Envelope />
        <Environment preset="studio" />
      </Suspense>

      <EffectComposer>
        <Bloom
          intensity={isLight ? 0.18 : 0.45}
          luminanceThreshold={isLight ? 0.75 : 0.5}
          luminanceSmoothing={0.9}
          mipmapBlur
        />
      </EffectComposer>
    </Canvas>
  );
}
