import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  useGLTF,
  Environment,
  Lightformer,
} from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { useTheme } from '../../contexts/ThemeContext';

const MODEL_URL = `${import.meta.env.BASE_URL}models/Meshy_AI_Realistic_style_Solid_0416043256_texture.glb`;

const globalMouse = { x: 0, y: 0 };
const globalScroll = { progress: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener('mousemove', (e) => {
    globalMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    globalMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });
  const updateScroll = () => {
    const h = window.innerHeight;
    const y = Math.min(window.scrollY, h * 1.5);
    globalScroll.progress = Math.min(1, y / h);
  };
  window.addEventListener('scroll', updateScroll, { passive: true });
  updateScroll();
}

function CyborgModel() {
  const { scene } = useGLTF(MODEL_URL);
  const group = useRef<THREE.Group>(null);

  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (!m) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    m.envMapIntensity = 4.0;
    m.roughness = 0.03;
    m.metalness = 1.0;
    if (m.emissive && (m.emissive.r > 0.1 || m.color.r > 0.4)) {
      m.emissiveIntensity = 5.0;
      m.toneMapped = false;
    }
    m.needsUpdate = true;
  });

  const targetRotation = useRef({ x: 0, y: 0 });
  const currentRotation = useRef({ x: 0, y: 0 });
  const currentOffset = useRef({ x: 0, y: 0 });

  useFrame((state) => {
    if (!group.current) return;
    const mx = globalMouse.x;
    const my = globalMouse.y;
    const sp = globalScroll.progress;
    targetRotation.current.y = mx * 0.7 + sp * 0.35;
    targetRotation.current.x = -(my * 0.45) + sp * 0.18;
    const k = 0.06;
    currentRotation.current.y += (targetRotation.current.y - currentRotation.current.y) * k;
    currentRotation.current.x += (targetRotation.current.x - currentRotation.current.x) * k;
    group.current.rotation.y = currentRotation.current.y;
    group.current.rotation.x = currentRotation.current.x;

    const targetOffsetX = -mx * 0.12;
    const targetOffsetY = -my * 0.08 - sp * 0.25;
    currentOffset.current.x += (targetOffsetX - currentOffset.current.x) * 0.05;
    currentOffset.current.y += (targetOffsetY - currentOffset.current.y) * 0.05;
    group.current.position.x = currentOffset.current.x;
    group.current.position.y =
      currentOffset.current.y + Math.sin(state.clock.elapsedTime * 0.6) * 0.02;

    const baseScale = 1 - sp * 0.12;
    group.current.scale.setScalar(baseScale);
  });

  return (
    <group ref={group}>
      <primitive object={scene} scale={1.4} position={[0, -0.2, 0]} />
    </group>
  );
}

export function HeroCanvas() {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';
  return (
    <Canvas
      camera={{ position: [0.1, 0.15, 5.1], fov: 38 }}
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.7,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Environment resolution={512}>
        <group rotation={[-Math.PI / 4, 0, 0]}>
          <Lightformer
            form="rect"
            intensity={3}
            position={[0, 5, -2]}
            scale={[12, 2, 1]}
            rotation-x={Math.PI / 2}
            color="#ffffff"
          />
          <Lightformer
            form="rect"
            intensity={2}
            position={[6, 1, 0]}
            scale={[1, 8, 1]}
            rotation-y={-Math.PI / 2}
            color="#ffffff"
          />
          <Lightformer
            form="rect"
            intensity={1}
            position={[-6, 1, 0]}
            scale={[1, 8, 1]}
            rotation-y={Math.PI / 2}
            color="#aabbcc"
          />
          <Lightformer
            form="circle"
            color="#ff3300"
            intensity={6}
            position={[-3, 2, -4]}
            scale={3}
          />
          <Lightformer
            form="circle"
            color="#ffffff"
            intensity={8}
            position={[1, 4, 2]}
            scale={0.5}
          />
        </group>
      </Environment>

      <ambientLight intensity={0.05} />
      <directionalLight
        position={[3, 5, 2]}
        intensity={1.5}
        color="#ffffff"
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <directionalLight position={[-4, 2, -3]} intensity={2.5} color="#ff4400" />
      <pointLight position={[0, -2, 2]} intensity={0.2} color="#7C3AED" />

      <Suspense fallback={null}>
        <CyborgModel />
      </Suspense>

      <EffectComposer>
        <Bloom luminanceThreshold={0.1} luminanceSmoothing={0.9} intensity={0.5} mipmapBlur />
        <ChromaticAberration offset={[0.00015, 0.00015]} radialModulation={false} modulationOffset={0} />
        <Vignette eskil={false} offset={0.1} darkness={isLight ? 0.25 : 0.85} />
      </EffectComposer>
    </Canvas>
  );
}

useGLTF.preload(MODEL_URL);
