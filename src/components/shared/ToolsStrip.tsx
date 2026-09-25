'use client';

import { Box, Code, GitBranch, Keyboard, Laptop, Terminal, type LucideIcon } from 'lucide-react';
import { Marquee, Reveal } from '@/components/motion';
import tools from '@/data/tools.json';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';

type Tool = { icon: string; label: string; value: string };

const TOOLS = tools as Tool[];
const ICONS: Record<string, LucideIcon> = { Code, Laptop, Terminal, GitBranch, Box, Keyboard };

function ToolItem({ tool, framed }: { tool: Tool; framed?: boolean }) {
  const Icon = ICONS[tool.icon] ?? Code;
  return (
    <div
      className={
        framed
          ? 'flex shrink-0 items-start gap-3 rounded-xl border border-hairline bg-surface-tint px-4 py-3'
          : 'flex items-start gap-3'
      }
    >
      <Icon aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-violet-bright" />
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">{tool.label}</p>
        <p className="mt-0.5 text-sm text-text-secondary">{tool.value}</p>
      </div>
    </div>
  );
}

/**
 * The daily setup (src/data/tools.json). Two marquee rows drift in opposite
 * directions and lean with scroll speed; when motion is paused or reduced it is a
 * still grid. Values are never truncated.
 */
export function ToolsStrip() {
  const { paused } = useMotionPrefs();
  const half = Math.ceil(TOOLS.length / 2);
  const rows = [TOOLS.slice(0, half), TOOLS.slice(half)];

  return (
    <div className="container-padding mx-auto max-w-[1440px] py-10" data-tools-strip="">
      <Reveal className="glass overflow-clip rounded-2xl p-5 md:p-6">
        <div className="mb-4 flex items-center gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-text">Daily setup</p>
          <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-cyan-bright/40 to-transparent" />
        </div>
        {paused ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" data-tools-static="">
            {TOOLS.map((tool) => (
              <li key={tool.label}>
                <ToolItem tool={tool} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="skills-tools-marquee -mx-5 space-y-3 md:-mx-6">
            {rows.map((row, i) => (
              <Marquee
                key={i}
                direction={i === 0 ? 'left' : 'right'}
                speed={28}
                velocity
                gap="0.75rem"
                ariaLabel={i === 0 ? 'Daily setup' : 'Daily setup, continued'}
              >
                {row.map((tool) => (
                  <ToolItem key={tool.label} tool={tool} framed />
                ))}
              </Marquee>
            ))}
          </div>
        )}
      </Reveal>
    </div>
  );
}
