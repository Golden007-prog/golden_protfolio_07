'use client';

import { Text } from '@react-three/drei';
import { Canvas, extend, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { preload as preloadSuspended } from 'suspend-react';
import * as THREE from 'three';
// @ts-expect-error -- troika-three-text (installed with drei) ships no type declarations.
import { BatchedText, preloadFont } from 'troika-three-text';
import { useDeviceCapability } from '@/hooks/useDeviceCapability';
import { useFrameloop } from '@/hooks/useFrameloop';
import { getMotionPrefs, useMotionPrefs } from '@/hooks/useMotionPrefs';
import { useThemeTokens, type ThemeTokens } from '@/hooks/useThemeTokens';
import { NODE_CHARACTERS, SKILL_NODES } from '@/lib/skills';
import type { SkillAccent, SkillNode } from '@/types/skills';
import { BLOOM_RADIUS, bloomLevels } from './bloomLevels';
import { onNodeListKeyDown, rovingIndex } from './SkillConstellation';
import { ALL, useSkillActions, useSkillFocus, useSkillList } from './SkillFocusContext';

// One draw call (two with the outline) for every label on the sphere.
extend({ BatchedText });

declare module '@react-three/fiber' {
  interface ThreeElements {
    batchedText: ThreeElements['mesh'];
  }
}

declare global {
  interface Window {
    /** Render stats for tests: frames drawn and draw calls of the last scene pass. */
    __skillSphere?: { frames: number; drawCalls: number };
  }
}

// Self-hosted (OFL) so troika never falls back to a CDN font; TTF because troika cannot parse woff2.
const FONT_URL = '/fonts/JetBrainsMono-Medium.ttf';
const RADIUS = 2.2;
/** Bounding radius of the nodes plus their widest labels, which the camera always fits. */
const FIT_RADIUS = 3.05;
const FOV = 45;
const DRAG_SLOP = 6;
const DRAG_RADIANS_PER_PX = 0.008;
const LABEL_MAX_WIDTH = 1.9;
// Nodes are pushed past 1.0 so only they cross the bloom threshold; labels stay crisp.
const BLOOM_BOOST = 6;
const BLOOM_THRESHOLD = 1.05;

let labelsReady: Promise<void> | null = null;

/**
 * Resolves once the label font is parsed and its glyphs are built. drei's <Text>
 * suspends on suspend-react's cache under ['troika-text', font, characters]
 * (drei core/Text.js); filling that entry first lets the labels mount without
 * suspending. The Suspense inside the Canvas still catches one if drei changes.
 */
export function preloadLabels(): Promise<void> {
  if (!labelsReady) {
    labelsReady = new Promise<void>((resolve) => preloadFont({ font: FONT_URL, characters: NODE_CHARACTERS }, () => resolve()));
    preloadSuspended(labelsReady, ['troika-text', FONT_URL, NODE_CHARACTERS]);
  }
  return labelsReady;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

type DragState = {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
  /** Radians not yet applied by the frame loop. */
  yaw: number;
  pitch: number;
};

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function isDarkHex(hex: string): boolean {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.4;
}

function accentColor(tokens: ThemeTokens, accent: SkillAccent): string {
  return accent === 'cyan'
    ? tokens.cyanBright
    : accent === 'amber'
      ? tokens.amber
      : accent === 'pink'
        ? tokens.pink
        : tokens.violetBright;
}

/** Distance at which a sphere of FIT_RADIUS fills the narrower field of view. */
function fitDistance(aspect: number): number {
  const vHalf = THREE.MathUtils.degToRad(FOV / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return FIT_RADIUS / Math.sin(Math.min(vHalf, hHalf));
}

type LabelMesh = THREE.Mesh & {
  fillOpacity: number;
  outlineOpacity: number;
  color: THREE.ColorRepresentation;
  /** Set by troika once the label is typeset; null until then. */
  textRenderInfo: object | null;
};

type SceneProps = {
  nodes: readonly SkillNode[];
  wrapRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
  dragRef: RefObject<DragState>;
  scrollRef: RefObject<{ p: number }>;
  scrub: boolean;
  tokens: ThemeTokens;
  dark: boolean;
  bloom: boolean;
  /** Called on every frame once the nodes and all their labels are on screen. */
  onDrawn: () => void;
};

// Scratch objects for the frame loop (one sphere exists at a time).
const T = {
  parentQ: new THREE.Quaternion(),
  parentInv: new THREE.Quaternion(),
  worldQ: new THREE.Quaternion(),
  worldInv: new THREE.Quaternion(),
  billboard: new THREE.Quaternion(),
  step: new THREE.Quaternion(),
  turn: new THREE.Quaternion(),
  local: new THREE.Quaternion(),
  identity: new THREE.Quaternion(),
  v: new THREE.Vector3(),
  camDir: new THREE.Vector3(),
  up: new THREE.Vector3(),
  scale: new THREE.Vector3(),
  m: new THREE.Matrix4(),
};

function recordStats(renderer: THREE.WebGLRenderer) {
  const stats = window.__skillSphere;
  if (!stats) return;
  stats.frames++;
  stats.drawCalls = renderer.info.render.calls;
}

function SphereScene({ nodes, wrapRef, listRef, dragRef, scrollRef, scrub, tokens, dark, bloom, onDrawn }: SceneProps) {
  const { selected, hovered } = useSkillFocus();
  const { filter } = useSkillList();
  const { select, open } = useSkillActions();
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  const size = useThree((st) => st.size);

  const tiltRef = useRef<THREE.Group>(null);
  const spinRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const nodeMeshRef = useRef<THREE.InstancedMesh>(null);
  const hitMeshRef = useRef<THREE.InstancedMesh>(null);
  const labelsRef = useRef<(LabelMesh | null)[]>([]);
  const hoverRef = useRef(-1);
  const suppressedRef = useRef<string | null>(null);
  const wasDraggingRef = useRef(false);
  const velocityRef = useRef({ yaw: 0, pitch: 0 });
  const scalesRef = useRef<number[]>(nodes.map(() => 1));
  const sceneRef = useRef<THREE.Scene | null>(null);
  /** Frames drawn since every label was typeset; -1 until then. */
  const typesetFramesRef = useRef(-1);

  const local = useMemo(() => nodes.map((n) => new THREE.Vector3(...n.dir).multiplyScalar(RADIUS)), [nodes]);

  // Place every instance once; setColorAt also creates instanceColor before the first compile.
  useLayoutEffect(() => {
    const nodeMesh = nodeMeshRef.current;
    const hitMesh = hitMeshRef.current;
    if (!nodeMesh || !hitMesh) return;
    const white = new THREE.Color(1, 1, 1);
    local.forEach((p, i) => {
      T.m.makeTranslation(p);
      nodeMesh.setMatrixAt(i, T.m);
      hitMesh.setMatrixAt(i, T.m);
      nodeMesh.setColorAt(i, white);
    });
    nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    hitMesh.instanceMatrix.needsUpdate = true;
    hitMesh.computeBoundingSphere();
  }, [local]);

  // Fit the camera to the stage's live aspect, and size labels to ~11-12 screen px.
  // A hidden (re-suspended) canvas measures 0x0; keep the last sane framing then.
  const distance = fitDistance(size.width > 0 && size.height > 0 ? size.width / size.height : 1);
  useLayoutEffect(() => {
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, distance]);
  const pxPerUnit = size.height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
  const fontSize = THREE.MathUtils.clamp((Math.min(size.width, size.height) < 400 ? 11 : 12) / Math.max(1, pxPerUnit), 0.12, 0.3);

  // Frames drawn and the scene pass's draw calls, for tests.
  useEffect(() => {
    const stats = { frames: 0, drawCalls: 0 };
    window.__skillSphere = stats;
    return () => {
      const scene = sceneRef.current;
      if (scene?.onAfterRender === recordStats) Object.assign(scene, { onAfterRender: () => {} });
      if (window.__skillSphere === stats) delete window.__skillSphere;
    };
  }, []);

  const colors = useMemo(() => {
    const bg = new THREE.Color(tokens.bgBase);
    return nodes.map((n) => {
      const hex = accentColor(tokens, n.accent);
      const base = new THREE.Color(hex);
      return { hex, lit: base.clone().multiplyScalar(bloom ? BLOOM_BOOST : 1), dim: base.clone().lerp(bg, 0.7) };
    });
  }, [nodes, tokens, bloom]);

  useFrame((state, rawDelta) => {
    const g = tiltRef.current;
    const s = spinRef.current;
    const nodeMesh = nodeMeshRef.current;
    if (!g || !s || !nodeMesh) return;
    if (sceneRef.current !== state.scene) {
      sceneRef.current = state.scene;
      // scene.onAfterRender runs once the scene pass (before any bloom passes) is drawn.
      Object.assign(state.scene, { onAfterRender: recordStats });
    }
    const dt = Math.min(rawDelta, 0.1);
    const prefs = getMotionPrefs();

    // 1. The section's scroll scrub: scale in, a slight tilt, and a faster spin once in view.
    const p = scrollRef.current.p;
    const enter = scrub ? smoothstep(0.04, 0.34, p) : 1;
    g.scale.setScalar(0.72 + 0.28 * enter);
    g.rotation.x = scrub ? (p - 0.5) * 0.5 : 0;
    g.updateMatrixWorld();
    g.getWorldQuaternion(T.parentQ);
    T.parentInv.copy(T.parentQ).invert();

    // Rotations are expressed in world space, then conjugated into the tilt group's frame.
    const turnWorld = (q: THREE.Quaternion) => {
      T.local.copy(T.parentInv).multiply(q).multiply(T.parentQ);
      s.quaternion.premultiply(T.local);
    };

    // 2. Drag, then a little inertia once released.
    const drag = dragRef.current;
    const vel = velocityRef.current;
    const target = hovered ?? selected;
    // A drag hands the sphere to the user: stop pulling the current node to the front.
    if (drag.active && !wasDraggingRef.current) suppressedRef.current = target;
    wasDraggingRef.current = drag.active;
    let yaw = drag.yaw;
    let pitch = drag.pitch;
    drag.yaw = 0;
    drag.pitch = 0;
    if (drag.active) {
      vel.yaw = THREE.MathUtils.lerp(vel.yaw, yaw / Math.max(dt, 1e-3), 0.35);
      vel.pitch = THREE.MathUtils.lerp(vel.pitch, pitch / Math.max(dt, 1e-3), 0.35);
    } else if (!prefs.paused && (vel.yaw || vel.pitch)) {
      yaw += vel.yaw * dt;
      pitch += vel.pitch * dt;
      const decay = Math.exp(-dt * 4);
      vel.yaw = Math.abs(vel.yaw * decay) < 0.01 ? 0 : vel.yaw * decay;
      vel.pitch = Math.abs(vel.pitch * decay) < 0.01 ? 0 : vel.pitch * decay;
    } else {
      vel.yaw = 0;
      vel.pitch = 0;
    }
    if (yaw) turnWorld(T.turn.setFromAxisAngle(Y_AXIS, yaw));
    if (pitch) turnWorld(T.turn.setFromAxisAngle(X_AXIS, pitch));

    // 3. Turn the hovered or selected node to face the camera, from wherever the camera
    //    and the sphere are; otherwise idle-spin about the vertical.
    if (target !== suppressedRef.current) suppressedRef.current = null;
    const ti = target ? nodes.findIndex((n) => n.name === target) : -1;
    T.camDir.copy(camera.position).normalize();
    s.updateMatrixWorld();
    if (ti >= 0 && suppressedRef.current === null && !drag.active) {
      s.localToWorld(T.v.copy(local[ti])).normalize();
      T.turn.setFromUnitVectors(T.v, T.camDir);
      T.step.copy(T.identity).slerp(T.turn, 1 - Math.exp(-dt * 5));
      turnWorld(T.step);
    } else if (!drag.active && !prefs.paused && vel.yaw === 0) {
      turnWorld(T.turn.setFromAxisAngle(Y_AXIS, dt * (scrub ? 0.08 + 0.1 * enter : 0.14)));
    }
    s.updateMatrixWorld();

    // 4. Nodes, labels and the selection ring.
    s.getWorldQuaternion(T.worldQ);
    T.worldInv.copy(T.worldQ).invert();
    T.billboard.copy(T.worldInv).multiply(camera.quaternion);
    T.up.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(T.worldInv);

    const scales = scalesRef.current;
    const selIdx = selected ? nodes.findIndex((n) => n.name === selected) : -1;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const active = i === ti || i === hoverRef.current;
      const dim = filter !== ALL && n.category !== filter;
      const goal = i === selIdx ? 1.8 : active ? 1.4 : dim ? 0.7 : 1;
      const sc = THREE.MathUtils.damp(scales[i], goal, 10, dt);
      scales[i] = sc;
      T.m.compose(local[i], T.identity, T.scale.setScalar(sc));
      nodeMesh.setMatrixAt(i, T.m);
      nodeMesh.setColorAt(i, dim ? colors[i].dim : colors[i].lit);

      const label = labelsRef.current[i];
      if (!label) continue;
      s.localToWorld(T.v.copy(local[i])).normalize();
      const facing = smoothstep(-0.2, 0.5, T.v.dot(T.camDir));
      const opacity = dim ? 0.15 : active ? 1 : 0.2 + 0.8 * facing;
      label.position.copy(local[i]).addScaledVector(T.up, 0.12 * sc + 0.06);
      label.quaternion.copy(T.billboard);
      label.scale.setScalar(i === selIdx ? 1.3 : 1);
      label.fillOpacity = opacity;
      label.outlineOpacity = opacity * 0.85;
      label.color = active ? colors[i].hex : tokens.textPrimary;
    }
    nodeMesh.instanceMatrix.needsUpdate = true;
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;

    const ring = ringRef.current;
    if (ring) {
      ring.visible = selIdx >= 0;
      if (selIdx >= 0) {
        ring.position.copy(local[selIdx]);
        ring.quaternion.copy(T.billboard);
        ring.scale.setScalar(scales[selIdx] / 1.8);
        (ring.material as THREE.MeshBasicMaterial).color.copy(colors[selIdx].lit);
      }
    }

    // 5. The sphere is on screen once a frame has drawn every label: troika typesets
    //    each one in a worker after mount, and the batch repacks on the next render.
    if (typesetFramesRef.current < 0) {
      const labels = labelsRef.current;
      if (labels.length === nodes.length && labels.every((l) => l?.textRenderInfo)) typesetFramesRef.current = 0;
    } else if (typesetFramesRef.current < 2) {
      typesetFramesRef.current++;
    } else {
      onDrawn();
    }
  });

  const setHover = (i: number) => {
    hoverRef.current = i;
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (i >= 0) {
      wrap.setAttribute('data-node-hover', '');
      wrap.setAttribute('data-cursor', 'open');
    } else {
      wrap.removeAttribute('data-node-hover');
      wrap.setAttribute('data-cursor', 'drag');
    }
  };

  const onNodeClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > DRAG_SLOP || e.instanceId === undefined) return;
    const node = nodes[e.instanceId];
    if (!node) return;
    suppressedRef.current = null;
    select(node.name);
    const opener = listRef.current?.querySelector<HTMLElement>(`[data-node="${node.slug}"]`) ?? null;
    open(node.name, { opener });
  };

  return (
    <group ref={tiltRef}>
      <group ref={spinRef}>
        <mesh raycast={() => null}>
          <sphereGeometry args={[RADIUS - 0.05, 32, 20]} />
          <meshBasicMaterial color={tokens.violet} wireframe transparent opacity={dark ? 0.15 : 0.22} depthWrite={false} />
        </mesh>
        <instancedMesh ref={nodeMeshRef} args={[undefined, undefined, nodes.length]} raycast={() => null}>
          <sphereGeometry args={[0.09, 20, 14]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
        {/* A hidden, larger twin takes the taps: a 0.09 sphere is far below a finger. */}
        <instancedMesh
          ref={hitMeshRef}
          args={[undefined, undefined, nodes.length]}
          onClick={onNodeClick}
          onPointerOver={(e) => {
            e.stopPropagation();
            if (e.instanceId !== undefined) setHover(e.instanceId);
          }}
          onPointerOut={() => setHover(-1)}
        >
          <sphereGeometry args={[0.28, 8, 6]} />
          <meshBasicMaterial visible={false} />
        </instancedMesh>
        <mesh ref={ringRef} visible={false} raycast={() => null}>
          <ringGeometry args={[0.2, 0.235, 48]} />
          <meshBasicMaterial transparent opacity={0.9} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
        </mesh>
        <batchedText renderOrder={2} frustumCulled={false} raycast={() => null}>
          <meshBasicMaterial attach="material" transparent depthWrite={false} />
          {nodes.map((n, i) => (
            <Text
              key={n.slug}
              ref={(el: LabelMesh | null) => {
                labelsRef.current[i] = el;
              }}
              font={FONT_URL}
              characters={NODE_CHARACTERS}
              fontSize={fontSize}
              maxWidth={LABEL_MAX_WIDTH}
              textAlign="center"
              anchorX="center"
              anchorY="bottom"
              lineHeight={1.1}
              outlineWidth={fontSize * 0.09}
              outlineColor={tokens.bgBase}
            >
              {n.name}
            </Text>
          ))}
        </batchedText>
      </group>
    </group>
  );
}

/** Only the boosted nodes cross the threshold; the glow is sized to stay inside the canvas. */
function SphereBloom() {
  const levels = useThree((st) => bloomLevels(Math.min(st.size.width, st.size.height) * st.viewport.dpr));
  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={0.9}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={0.05}
        mipmapBlur
        levels={levels}
        radius={BLOOM_RADIUS}
      />
    </EffectComposer>
  );
}

/**
 * The WebGL skill sphere (lazy chunk, mounted by Deferred3D). The nodes are one
 * instanced mesh, the labels one batched troika text, so a frame is at most five
 * draw calls; nothing renders while the stage is offscreen. Drag spins it (sideways
 * only on touch, where vertical swipes keep scrolling); tapping a node opens it and
 * turns it to face the camera. Scrolling through the section scales and tilts it on
 * desktop. The canvas is hidden from assistive tech: a visually hidden list of the
 * same nodes carries keyboard and screen-reader access.
 */
export function SkillSphere() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const frameloop = useFrameloop(wrapRef);
  const prefs = useMotionPrefs();
  const { lowPower } = useDeviceCapability();
  const tokens = useThemeTokens();
  const dark = isDarkHex(tokens.bgBase);
  const { setSphereLive, select, open } = useSkillActions();
  const { selected } = useSkillFocus();
  const scrub = !prefs.lite && !prefs.reduce;
  const bloom = dark && !lowPower;
  const nodes = SKILL_NODES;

  const dragRef = useRef<DragState>({ id: -1, startX: 0, startY: 0, lastX: 0, lastY: 0, active: false, yaw: 0, pitch: 0 });
  const scrollRef = useRef({ p: 0 });

  // data-drawn tells Deferred3D's handoff that the sphere is on screen, so the
  // constellation over it can fade out; the subtitle switches with it.
  const markDrawn = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || wrap.hasAttribute('data-drawn')) return;
    wrap.setAttribute('data-drawn', '');
    setSphereLive(true);
  }, [setSphereLive]);

  // Layout effect, so both drop while a re-suspended canvas is hidden behind the fallback.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    return () => {
      wrap?.removeAttribute('data-drawn');
      setSphereLive(false);
    };
  }, [setSphereLive]);

  useEffect(() => {
    if (!scrub) return;
    const section = document.getElementById('skills');
    if (!section) return;
    gsap.registerPlugin(ScrollTrigger);
    const target = scrollRef.current;
    const to = gsap.quickTo(target, 'p', { duration: 0.6, ease: 'power3.out' });
    const trigger = ScrollTrigger.create({
      trigger: section,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => to(self.progress),
    });
    to(trigger.progress);
    return () => {
      trigger.kill();
      gsap.killTweensOf(target);
    };
  }, [scrub]);

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (e.pointerId !== d.id) return;
    d.id = -1;
    d.active = false;
    e.currentTarget.removeAttribute('data-dragging');
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const tabStop = rovingIndex(nodes, selected);

  return (
    <div
      ref={wrapRef}
      className="skills-sphere relative h-full w-full rounded-3xl has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-focus-ring"
      data-skills-mode="sphere"
      data-cursor="drag"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const d = dragRef.current;
        d.id = e.pointerId;
        d.startX = d.lastX = e.clientX;
        d.startY = d.lastY = e.clientY;
        d.active = false;
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (e.pointerId !== d.id) return;
        const dx = e.clientX - d.lastX;
        const dy = e.clientY - d.lastY;
        d.lastX = e.clientX;
        d.lastY = e.clientY;
        if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_SLOP) {
          d.active = true;
          e.currentTarget.setAttribute('data-dragging', '');
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* the pointer is already gone */
          }
        }
        if (!d.active) return;
        d.yaw += dx * DRAG_RADIANS_PER_PX;
        // Touch rotates about the vertical only; vertical swipes belong to the page.
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') d.pitch += dy * DRAG_RADIANS_PER_PX;
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div aria-hidden="true" className="absolute inset-0">
        <Canvas
          frameloop={frameloop}
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, fitDistance(1)], fov: FOV }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          onPointerMissed={() => select(null)}
        >
          {/* A suspension in here (the label font) must not reach Deferred3D's
              boundary: R3F would re-suspend the whole stage behind the fallback. */}
          <Suspense fallback={null}>
            <SphereScene
              nodes={nodes}
              wrapRef={wrapRef}
              listRef={listRef}
              dragRef={dragRef}
              scrollRef={scrollRef}
              scrub={scrub}
              tokens={tokens}
              dark={dark}
              bloom={bloom}
              onDrawn={markDrawn}
            />
            {bloom ? <SphereBloom /> : null}
          </Suspense>
        </Canvas>
      </div>

      <ul ref={listRef} aria-label="Skills on the sphere" data-node-list="" className="sr-only">
        {nodes.map((node, i) => (
          <li key={node.slug}>
            <button
              type="button"
              data-node={node.slug}
              aria-haspopup="dialog"
              aria-label={`${node.name}, ${node.category}`}
              tabIndex={i === tabStop ? 0 : -1}
              onFocus={() => select(node.name)}
              onKeyDown={(e) => onNodeListKeyDown(e, nodes, i, { select })}
              onClick={(e) => open(node.name, { opener: e.currentTarget })}
            >
              {node.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SkillSphere;
