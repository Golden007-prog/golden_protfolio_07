'use client';

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { animate } from 'framer-motion';
import { Check, CircleAlert } from 'lucide-react';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { ease, spring } from '@/lib/motion';
import { LottieIcon, preloadLottie } from '@/components/shared/LottieIcon';
import { Slot, useComposedRefs } from '@/components/ui/Slot';
import { cn } from '@/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonStatus = 'idle' | 'loading' | 'success' | 'error';

type Base = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  status?: ButtonStatus;
  /** Visible label and live announcement while loading (default announcement 'Loading'). */
  loadingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** One light sweep per hover-in. Default: on for primary. */
  shine?: boolean;
  /** Ink ripple from the press point. Default on. */
  ripple?: boolean;
  /** Pulls toward the pointer on fine hover pointers. A number sets the strength (default 0.25). */
  magnetic?: boolean | number;
  fullWidth?: boolean;
  cursor?: 'view' | 'open' | 'copy' | 'download' | 'drag';
  /** Lends the button's behaviour and styling to its only child (e.g. a next/link Link). */
  asChild?: boolean;
  /** Replaces the default status icons (spinner, success animation, alert). */
  statusIcons?: Partial<Record<Exclude<ButtonStatus, 'idle'>, ReactNode>>;
  className?: string;
  children?: ReactNode;
};

export type ButtonProps = Base &
  (
    | (ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined })
    | (AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; external?: boolean; download?: string | boolean })
  );

const DEFAULT_ANNOUNCEMENT: Record<Exclude<ButtonStatus, 'idle'>, string> = {
  loading: 'Loading',
  success: 'Done',
  error: 'Something went wrong',
};

// Every size keeps a >=44px hit area: sm is 36px under a mouse with a 4px
// invisible halo, and a full 44px wherever a coarse pointer exists.
const SIZE: Record<ButtonSize, { text: string; square: string }> = {
  sm: {
    text: "tap-safe-sm gap-1.5 px-3.5 text-[13px] leading-tight before:absolute before:-inset-1 before:content-[''] any-pointer-coarse:before:inset-0",
    square: "tap-safe-sm px-0 before:absolute before:-inset-1 before:content-[''] any-pointer-coarse:before:inset-0",
  },
  md: { text: 'tap-safe gap-2 px-5 text-sm leading-tight', square: 'tap-safe px-0' },
  lg: { text: 'tap-safe min-h-12 gap-2.5 px-7 text-[15px] leading-tight', square: 'tap-safe min-h-12 min-w-12 px-0' },
};

const VARIANT: Record<ButtonVariant, string> = {
  // White text on violet stays >=4.5:1 in both themes because the gradient only
  // leans a quarter of the way toward the brighter violet.
  primary:
    'bg-[linear-gradient(135deg,var(--app-violet),color-mix(in_oklab,var(--app-violet)_72%,var(--app-violet-bright)))] text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22),inset_0_0_14px_0_rgb(255_255_255/0.08)] hover:glow-violet',
  secondary:
    'border border-glass-border bg-glass-fill text-text-primary backdrop-blur-md hover:border-glass-border-strong hover:bg-glass-fill-strong',
  ghost: 'text-text-secondary hover:bg-surface-tint hover:text-text-primary',
  outline: 'border border-glass-border-strong text-text-primary hover:border-violet-bright',
  icon: 'border border-glass-border bg-glass-fill text-text-secondary hover:border-glass-border-strong hover:text-text-primary',
};

const SUCCESS_ON_ACCENT = { '#0E7490': '#FFFFFF', '#67E8F9': '#FFFFFF', '#22D3EE': '#FFFFFF' };
const SUCCESS_COLORS_ON_ACCENT = { dark: SUCCESS_ON_ACCENT, light: SUCCESS_ON_ACCENT };

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(props, forwardedRef) {
  const {
    variant = 'primary',
    size = 'md',
    status = 'idle',
    loadingLabel,
    successLabel,
    errorLabel,
    leadingIcon,
    trailingIcon,
    shine,
    ripple = true,
    magnetic = false,
    fullWidth = false,
    cursor,
    asChild = false,
    statusIcons,
    className,
    children,
    ...rest
  } = props;

  const prefs = useMotionPrefs();
  const elRef = useRef<HTMLElement | null>(null);
  const rippleHostRef = useRef<HTMLSpanElement>(null);
  const ref = useComposedRefs<HTMLElement>(forwardedRef, elRef);

  const isAnchor = typeof rest.href === 'string';
  const newTab = isAnchor && ((rest as { external?: boolean }).external ?? isExternalHref(rest.href as string));
  const isLoading = status === 'loading';
  const decorate = !prefs.reduce;
  const showShine = decorate && (shine ?? variant === 'primary');
  const magnetStrength = typeof magnetic === 'number' ? magnetic : magnetic ? 0.25 : 0;
  const magnetOn = magnetStrength > 0 && decorate && prefs.finePointer && prefs.hover && !fullWidth;

  const statusLabel =
    status === 'loading' ? loadingLabel : status === 'success' ? successLabel : status === 'error' ? errorLabel : undefined;
  const announcement = status === 'idle' ? '' : (statusLabel ?? DEFAULT_ANNOUNCEMENT[status]);

  // Warm the success animation while the action is still running.
  useEffect(() => {
    if (isLoading && !statusIcons?.success) preloadLottie('success');
  }, [isLoading, statusIcons?.success]);

  // Error: a short, firm horizontal shake (none under reduced motion).
  useEffect(() => {
    const el = elRef.current;
    if (status !== 'error' || prefs.reduce || !el) return;
    const controls = animate(el, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.36, ease: ease.inOut });
    return () => controls.stop();
  }, [status, prefs.reduce]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || variant !== 'icon') return;
    const el = elRef.current;
    if (el && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) {
      console.warn('Button variant="icon" needs an aria-label.', el);
    }
  }, [variant]);

  const disabled = !isAnchor && Boolean((rest as ButtonHTMLAttributes<HTMLButtonElement>).disabled);
  const inert = disabled || isLoading;

  const spawnRipple = (e: ReactPointerEvent<HTMLElement>) => {
    const host = rippleHostRef.current;
    if (!host || typeof host.animate !== 'function') return;
    const rect = host.getBoundingClientRect();
    const d = Math.hypot(rect.width, rect.height) * 2;
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    Object.assign(dot.style, {
      position: 'absolute',
      left: `${e.clientX - rect.left - d / 2}px`,
      top: `${e.clientY - rect.top - d / 2}px`,
      width: `${d}px`,
      height: `${d}px`,
      borderRadius: '9999px',
      background: 'currentColor',
      pointerEvents: 'none',
    });
    host.appendChild(dot);
    const anim = dot.animate(
      [
        { transform: 'scale(0)', opacity: 0.22 },
        { transform: 'scale(1)', opacity: 0 },
      ],
      { duration: 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => dot.remove();
    anim.oncancel = () => dot.remove();
  };

  const press = (scale: number) => {
    const el = elRef.current;
    if (el && decorate) animate(el, { scale }, spring.press);
  };

  const theirs = rest as Record<string, unknown>;
  const callTheirs = (key: string, e: ReactPointerEvent<HTMLElement>) => {
    const fn = theirs[key];
    if (typeof fn === 'function') (fn as (e: ReactPointerEvent<HTMLElement>) => void)(e);
  };
  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      callTheirs('onPointerDown', e);
      if (inert || e.button !== 0) return;
      press(0.97);
      if (ripple && decorate) spawnRipple(e);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      callTheirs('onPointerUp', e);
      press(1);
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      callTheirs('onPointerCancel', e);
      press(1);
    },
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => {
      callTheirs('onPointerLeave', e);
      press(1);
      const el = elRef.current;
      if (el && magnetOn) animate(el, { x: 0, y: 0 }, spring.pointer);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      callTheirs('onPointerMove', e);
      const el = elRef.current;
      if (!el || !magnetOn || e.pointerType !== 'mouse') return;
      const r = el.getBoundingClientRect();
      animate(
        el,
        {
          x: (e.clientX - (r.left + r.width / 2)) * magnetStrength,
          y: (e.clientY - (r.top + r.height / 2)) * magnetStrength,
        },
        spring.pointer,
      );
    },
  };

  const userOnClick = theirs.onClick as ((e: ReactMouseEvent<HTMLElement>) => void) | undefined;
  const onClick = (e: ReactMouseEvent<HTMLElement>) => {
    // aria-disabled rather than disabled keeps focus on the button while it works.
    if (isLoading) {
      e.preventDefault();
      return;
    }
    userOnClick?.(e);
  };

  const statusIcon =
    status === 'loading' ? (
      (statusIcons?.loading ?? <Spinner />)
    ) : status === 'success' ? (
      (statusIcons?.success ?? (
        <LottieIcon
          name="success"
          play="once"
          loop={false}
          lazy={false}
          colors={variant === 'primary' ? SUCCESS_COLORS_ON_ACCENT : undefined}
          className="-my-1 block size-6 shrink-0"
          fallback={<Check aria-hidden="true" className="size-4" />}
        />
      ))
    ) : status === 'error' ? (
      (statusIcons?.error ?? <CircleAlert aria-hidden="true" className="size-4 shrink-0" />)
    ) : null;

  const renderInner = (label: ReactNode) => (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-[1] overflow-clip rounded-[inherit]"
        ref={rippleHostRef}
      >
        {showShine ? (
          <span className="absolute inset-y-0 -left-1/2 w-1/2 -translate-x-full -skew-x-12 bg-gradient-to-r from-transparent via-[rgb(255_255_255/0.28)] to-transparent transition-none group-hover/button:translate-x-[420%] group-hover/button:transition-transform group-hover/button:duration-700 group-hover/button:ease-out" />
        ) : null}
      </span>
      {statusIcon ?? leadingIcon}
      {statusLabel !== undefined && variant !== 'icon' ? <span>{statusLabel}</span> : label}
      {status === 'idle' ? trailingIcon : null}
      {newTab ? <span className="sr-only"> (opens in new tab)</span> : null}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </>
  );

  const rootClass = cn(
    'group/button relative isolate inline-flex select-none items-center justify-center rounded-full font-medium ring-focus',
    'transition-[color,background-color,border-color,box-shadow,opacity] duration-200 ease-out',
    'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-progress',
    variant === 'icon' ? SIZE[size].square : SIZE[size].text,
    VARIANT[variant],
    fullWidth && 'w-full',
    className,
  );

  const common = {
    ref,
    className: rootClass,
    'data-button': '',
    'data-variant': variant,
    'data-size': size,
    'data-status': status,
    'data-cursor': cursor,
    'aria-busy': isLoading || undefined,
    ...handlers,
  };

  if (asChild) {
    const only = Children.only(children);
    if (!isValidElement(only)) return null;
    const child = only as ReactElement<{ children?: ReactNode }>;
    const slotRest: Record<string, unknown> = { ...rest };
    delete slotRest.href;
    delete slotRest.external;
    return (
      <Slot {...slotRest} {...common} aria-disabled={inert || undefined} onClick={onClick}>
        {cloneElement(child, undefined, renderInner(child.props.children))}
      </Slot>
    );
  }

  if (isAnchor) {
    const anchorRest: Record<string, unknown> = { ...rest };
    delete anchorRest.external;
    const { download, href } = rest as { download?: string | boolean; href: string };
    // An aria-label replaces the sr-only hint in the accessible name, so carry the hint over.
    const label = anchorRest['aria-label'];
    if (newTab && typeof label === 'string' && !/new tab/i.test(label)) anchorRest['aria-label'] = `${label} (opens in new tab)`;
    return (
      <a
        {...anchorRest}
        {...common}
        href={href}
        download={download === true ? '' : download || undefined}
        target={newTab ? '_blank' : (anchorRest.target as string | undefined)}
        rel={newTab ? 'noopener noreferrer' : (anchorRest.rel as string | undefined)}
        aria-disabled={isLoading || undefined}
        onClick={onClick}
      >
        {renderInner(children)}
      </a>
    );
  }

  const { type = 'button', ...buttonRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button {...buttonRest} {...common} type={type} aria-disabled={isLoading || undefined} onClick={onClick}>
      {renderInner(children)}
    </button>
  );
});
