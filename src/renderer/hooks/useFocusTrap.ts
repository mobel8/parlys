// [EXPERIMENT:refonte-v1]
// Reusable focus trap hook for modals, popovers, and overlays.
// - Traps Tab / Shift+Tab inside the wrapped container
// - Auto-focuses the first focusable element on mount
// - Restores focus to the previously active element on unmount
//
// Usage:
//   const ref = useFocusTrap(isOpen);
//   return <div ref={ref} role="dialog" aria-modal="true">...</div>;
//
// The container receives tabIndex=-1 so it can hold focus if no
// focusable descendant exists. Elements with aria-hidden are excluded.

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active: boolean): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const previousActive = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('aria-hidden'),
      );

    const focusFirst = () => {
      const list = focusables();
      if (list.length) list[0].focus();
      else node.focus();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    node.tabIndex = -1;
    focusFirst();
    node.addEventListener('keydown', onKeyDown);

    return () => {
      node.removeEventListener('keydown', onKeyDown);
      previousActive?.focus?.();
    };
  }, [active]);

  return ref;
}
