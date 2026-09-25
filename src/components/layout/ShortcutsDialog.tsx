'use client';

import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useSingleKeyShortcuts } from '@/hooks/useHotkeys';
import { cn } from '@/utils/cn';

const noopSubscribe = () => () => {};
function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || '');
}

type Row = { keys: string[]; label: string; single?: boolean };

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded-md border border-glass-border-strong bg-surface-tint px-1.5 py-0.5 font-mono text-xs text-text-primary">
      {children}
    </kbd>
  );
}

type Props = { open: boolean; onClose: () => void };

/** The keyboard shortcuts, and the WCAG 2.1.4 switch that turns the single-key ones off. */
export function ShortcutsDialog({ open, onClose }: Props) {
  const mac = useSyncExternalStore(noopSubscribe, isMacPlatform, () => false);
  const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();

  const rows: Row[] = [
    { keys: [mac ? '⌘' : 'Ctrl', 'K'], label: 'Open the command palette' },
    { keys: ['/'], label: 'Open the command palette', single: true },
    { keys: ['T'], label: 'Switch between dark and light', single: true },
    { keys: ['M'], label: 'Sound on or off', single: true },
    { keys: ['?'], label: 'Show these shortcuts', single: true },
    { keys: ['Esc'], label: 'Close a dialog or menu' },
  ];

  return (
    <Dialog open={open} onClose={onClose} labelledBy="shortcuts-title" describedBy="shortcuts-desc" panelClassName="max-w-md">
      <div className="p-6 sm:p-8" data-shortcuts="">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="shortcuts-title" className="font-display text-2xl font-semibold tracking-tight text-text-primary">
              Keyboard shortcuts
            </h2>
            <p id="shortcuts-desc" className="mt-1 text-sm text-text-muted">
              They never fire while you are typing in a field.
            </p>
          </div>
          <Button variant="icon" aria-label="Close" onClick={onClose} className="-mr-2 -mt-2 shrink-0">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <ul className="flex flex-col divide-y divide-hairline">
          {rows.map((r) => {
            const off = r.single && !singleKeys;
            return (
              <li key={`${r.keys.join('+')}-${r.label}`} className="flex items-center justify-between gap-4 py-3">
                <span className={cn('text-sm', off ? 'text-text-muted line-through' : 'text-text-secondary')}>
                  {r.label}
                  {off ? <span className="sr-only"> (off)</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {r.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-hairline bg-surface-tint p-4">
          <div>
            <p id="single-keys-label" className="text-sm font-medium text-text-primary">
              Single-key shortcuts
            </p>
            <p className="text-[13px] text-text-muted">Turn off if you use speech input.</p>
          </div>
          <Button
            variant="ghost"
            role="switch"
            aria-checked={singleKeys}
            aria-labelledby="single-keys-label"
            onClick={() => setSingleKeys(!singleKeys)}
            className="shrink-0 px-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full border transition-colors',
                singleKeys ? 'border-violet-bright bg-violet' : 'border-glass-border-strong bg-surface-tint',
              )}
            >
              <span
                className={cn(
                  'absolute left-0.5 size-4.5 rounded-full transition-transform duration-200',
                  singleKeys ? 'translate-x-5 bg-bg-base' : 'bg-text-muted',
                )}
              />
            </span>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
