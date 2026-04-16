import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Environment, Text, OrbitControls, Billboard } from '@react-three/drei';
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

type NodeProps = {
  pos: [number, number, number];
  label: string;
  idx: number;
  isSelected: boolean;
  onSelect: (i: number) => void;
};

function Node({ pos, label, idx, isSelected, onSelect }: NodeProps) {
  const color = idx % 2 === 0 ? '#A855F7' : '#22D3EE';
  const scale = isSelected ? 1.8 : 1;
  const emissive = isSelected ? 2.6 : 1.4;
  const textSize = isSelected ? 0.2 : 0.14;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(idx);
  };
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  };
  const handlePointerOut = () => {
    document.body.style.cursor = '';
  };

  return (
    <group position={pos}>
      <mesh
        scale={scale}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[0.09, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissive}
          toneMapped={false}
        />
      </mesh>
      {isSelected && (
        <mesh>
          <ringGeometry args={[0.22, 0.26, 48]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      )}
      <Billboard follow position={[0, 0.26, 0]}>
        <Text
          fontSize={textSize}
          color={isSelected ? color : '#FAFAFA'}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.014}
          outlineColor="#0A0A0F"
          outlineOpacity={0.7}
          onClick={handleClick}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

function SphereMesh({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (i: number | null) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const positions = useMemo(() => fibonacciSphere(SKILL_NODES.length), []);

  useFrame((_s, delta) => {
    const g = group.current;
    if (!g) return;
    if (selected === null) {
      g.rotation.y += delta * 0.12;
      const ease = Math.min(1, delta * 3);
      g.rotation.x += (0 - g.rotation.x) * ease;
    } else {
      const [px, py, pz] = positions[selected];
      const targetY = Math.atan2(-px, pz);
      const targetX = Math.atan2(py, Math.sqrt(px * px + pz * pz));
      let dy = (targetY - g.rotation.y) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      const ease = Math.min(1, delta * 4);
      g.rotation.y += dy * ease;
      g.rotation.x += (targetX - g.rotation.x) * ease;
    }
  });

  return (
    <group ref={group} onPointerMissed={() => onSelect(null)}>
      <mesh>
        <sphereGeometry args={[2.15, 32, 32]} />
        <meshBasicMaterial color="#7C3AED" wireframe transparent opacity={0.15} />
      </mesh>
      {positions.map((p, i) => (
        <Node
          key={SKILL_NODES[i]}
          pos={p}
          label={SKILL_NODES[i]}
          idx={i}
          isSelected={selected === i}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

export function SkillSphere() {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 6.5], fov: 45 }}
        dpr={[1, 2]}
        onPointerMissed={() => setSelected(null)}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[5, 5, 5]} color="#7C3AED" intensity={2} />
        <pointLight position={[-5, -5, -3]} color="#22D3EE" intensity={1.5} />
        <Suspense fallback={null}>
          <SphereMesh selected={selected} onSelect={setSelected} />
          <Environment preset="night" />
        </Suspense>
        <OrbitControls enableZoom={false} enablePan={false} />
        <EffectComposer>
          <Bloom intensity={1.2} luminanceThreshold={0.3} mipmapBlur />
        </EffectComposer>
      </Canvas>
      {selected !== null && (
        <button
          onClick={() => setSelected(null)}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.25em] text-text-muted hover:text-violet-bright transition-colors px-3 py-1.5 rounded-full glass"
        >
          {SKILL_NODES[selected]} · tap to release
        </button>
      )}
    </div>
  );
}
