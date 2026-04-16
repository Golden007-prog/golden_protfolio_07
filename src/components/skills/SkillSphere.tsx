import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Environment, Text, OrbitControls, Billboard } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

const SKILL_NODES = [
  'Python', 'SQL', 'ML', 'LLMs', 'NLP', 'DL',
  'GPT', 'Gemini', 'PyTorch', 'TF', 'React', 'TS',
  'GCP', 'Azure', 'Docker', 'K8s', 'XGBoost', 'Prophet',
];

function fibonacciSphere(n: number, r = 2.2) {
  const pts: [number, number, number][] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = phi * i;
    pts.push([Math.cos(theta) * radius * r, y * r, Math.sin(theta) * radius * r]);
  }
  return pts;
}

function Node({ pos, label, idx }: { pos: [number, number, number]; label: string; idx: number }) {
  const color = idx % 2 === 0 ? '#A855F7' : '#22D3EE';
  return (
    <group position={pos}>
      <mesh>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <Billboard follow position={[0, 0.24, 0]}>
        <Text
          fontSize={0.14}
          color="#FAFAFA"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.012}
          outlineColor="#0A0A0F"
          outlineOpacity={0.6}
        >
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

function SphereMesh() {
  const group = useRef<THREE.Group>(null);
  const positions = useMemo(() => fibonacciSphere(SKILL_NODES.length), []);
  useFrame((_s, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.12;
  });
  return (
    <Float speed={1.2} rotationIntensity={0.3} floatIntensity={0.3}>
      <group ref={group}>
        <mesh>
          <sphereGeometry args={[2.15, 32, 32]} />
          <meshBasicMaterial color="#7C3AED" wireframe transparent opacity={0.15} />
        </mesh>
        {positions.map((p, i) => (
          <Node key={SKILL_NODES[i]} pos={p} label={SKILL_NODES[i]} idx={i} />
        ))}
      </group>
    </Float>
  );
}

export function SkillSphere() {
  return (
    <Canvas camera={{ position: [0, 0, 6.5], fov: 45 }} dpr={[1, 2]}>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} color="#7C3AED" intensity={2} />
      <pointLight position={[-5, -5, -3]} color="#22D3EE" intensity={1.5} />
      <Suspense fallback={null}>
        <SphereMesh />
        <Environment preset="night" />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.4} />
      <EffectComposer>
        <Bloom intensity={1.2} luminanceThreshold={0.3} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
