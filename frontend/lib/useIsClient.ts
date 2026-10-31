import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True only after hydration. Overlays render into a portal, so they must not exist
 * during SSR and must not flip during the hydration pass.
 */
export function useIsClient() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
