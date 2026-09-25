'use client';

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useCallback,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
} from 'react';
import { cn } from '@/utils/cn';

type AnyProps = Record<string, unknown>;

/** Assigns one node to any mix of callback refs, ref objects and nulls. */
export function assignRefs<T>(node: T | null, ...refs: (Ref<T> | undefined)[]): void {
  for (const ref of refs) {
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as { current: T | null }).current = node;
  }
}

/** A stable callback ref that feeds every given ref. */
export function useComposedRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the refs themselves are the dependencies
  return useCallback((node: T | null) => assignRefs(node, ...refs), refs);
}

/**
 * The child's own props take precedence, except that event handlers run child
 * first then slot, classes are merged (child classes win conflicts) and styles are
 * shallow-merged with the child's values on top.
 */
export function mergeSlotProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...slotProps, ...childProps };
  for (const key of Object.keys(slotProps)) {
    const slotValue = slotProps[key];
    const childValue = childProps[key];
    if (/^on[A-Z]/.test(key) && typeof slotValue === 'function' && typeof childValue === 'function') {
      merged[key] = (...args: unknown[]) => {
        (childValue as (...a: unknown[]) => unknown)(...args);
        (slotValue as (...a: unknown[]) => unknown)(...args);
      };
    } else if (key === 'className') {
      merged.className = cn(slotValue as string | undefined, childValue as string | undefined);
    } else if (key === 'style' && slotValue && childValue) {
      merged.style = { ...(slotValue as object), ...(childValue as object) };
    } else if (childValue === undefined) {
      merged[key] = slotValue;
    }
  }
  return merged;
}

export type SlotProps = HTMLAttributes<HTMLElement> & { children?: ReactNode };

/**
 * Renders its only child with the slot's props merged in, so a component can
 * lend its behaviour and styling to an element the caller chooses
 * (`<Button asChild><Link href="/x" /></Button>` renders one <a>).
 */
export const Slot = forwardRef<HTMLElement, SlotProps>(function Slot({ children, ...slotProps }, forwardedRef) {
  const child = isValidElement(children) ? (children as ReactElement<AnyProps>) : null;
  const childRef = child ? (child.props.ref as Ref<HTMLElement> | undefined) : undefined;
  const ref = useComposedRefs(forwardedRef, childRef);

  if (!child) {
    if (process.env.NODE_ENV !== 'production' && Children.count(children) > 1) {
      console.error('Slot expects a single React element child.');
    }
    return null;
  }
  return cloneElement(child, { ...mergeSlotProps(slotProps as AnyProps, child.props), ref });
});
