import { createElement, Suspense, use, useSyncExternalStore, type ComponentType } from 'react';

export type Preloadable<P extends object> = ComponentType<P> & {
  /** Starts the load once (a failed load is tried again on the next call) and resolves with the component. */
  preload: () => Promise<ComponentType<P>>;
  /** True once the module is in: from then on the component renders without suspending. */
  loaded: () => boolean;
};

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * A client-only lazy component, like next/dynamic(..., { ssr: false }), that stops
 * suspending for good once preload() has resolved. React.lazy (which next/dynamic
 * wraps) suspends on its first render even when the chunk is already cached, and
 * React then holds the retry back until 300ms after it committed the fallback, so
 * a dialog warmed at idle still took ~0.3s to appear on its first open.
 */
export function preloadable<P extends object>(load: () => Promise<ComponentType<P>>): Preloadable<P> {
  let component: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  const preload = (): Promise<ComponentType<P>> => {
    if (component) return Promise.resolve(component);
    pending ??= load().then(
      (loaded) => (component = loaded),
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  function Loaded(props: P) {
    return createElement(component ?? use(preload()), props);
  }

  function PreloadableComponent(props: P) {
    // The server and the hydration pass render nothing, as with ssr: false.
    const client = useSyncExternalStore(subscribeNothing, onClient, onServer);
    return client ? createElement(Suspense, { fallback: null }, createElement(Loaded, props)) : null;
  }

  return Object.assign(PreloadableComponent, { preload, loaded: () => component !== null });
}
