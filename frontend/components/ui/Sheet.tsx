"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useIsClient } from "../../lib/useIsClient";

const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-5xl",
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal surface rendered into a portal: centered card on tablets and up, bottom sheet on
 * phones. The portal matters — an ancestor with backdrop-filter would otherwise trap the
 * fixed positioning inside that element.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  bodyClassName = "",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof SIZES;
  bodyClassName?: string;
}) {
  const isClient = useIsClient();
  const panel = useRef<HTMLDivElement | null>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.dataset.sheet = "open";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const focus = setTimeout(() => panel.current?.focus(), 0);
    return () => {
      clearTimeout(focus);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      delete document.body.dataset.sheet;
      restore.current?.focus?.();
    };
  }, [open, onClose]);

  if (!isClient || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-90 flex items-end justify-center sm:items-center sm:p-6">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 animate-fade-in cursor-default bg-black/75 backdrop-blur-[3px]"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`glass-strong relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl outline-none sm:max-h-[min(88dvh,52rem)] sm:animate-pop sm:rounded-2xl ${SIZES[size]}`}
        style={{
          animation: "sheet-mobile-in 0.34s cubic-bezier(0.16, 1, 0.3, 1) both",
        }}
      >
        <span
          aria-hidden
          className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15 sm:hidden"
        />

        <header className="flex items-start gap-3 border-b border-white/8 px-4 py-3 sm:px-5 sm:py-4">
          {icon && (
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-300 ring-1 ring-inset ring-white/8">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold tracking-tight text-zinc-200">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs leading-snug text-zinc-500">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg bg-white/4 text-zinc-400 ring-1 ring-inset ring-white/8 transition-colors hover:text-zinc-100"
          >
            <X className="size-4" />
          </button>
        </header>

        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 ${bodyClassName}`}
        >
          {children}
        </div>

        {footer && (
          <footer className="safe-bottom border-t border-white/8 bg-black/30 px-4 py-3 sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
