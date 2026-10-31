"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "soft" | "ghost" | "danger" | "solid";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25 hover:bg-accent/20 hover:ring-accent/40",
  soft: "bg-white/4 text-zinc-300 ring-1 ring-inset ring-white/8 hover:bg-white/8 hover:text-white",
  ghost: "text-zinc-400 hover:bg-white/5 hover:text-white",
  danger:
    "bg-blood/10 text-blood ring-1 ring-inset ring-blood/35 hover:bg-blood/20",
  solid: "bg-accent font-semibold text-black hover:brightness-110",
};

const SIZE: Record<ButtonSize, string> = {
  xs: "h-7 gap-1.5 rounded-md px-2 text-[11px]",
  sm: "h-8 gap-1.5 rounded-lg px-2.5 text-[11px]",
  md: "h-9 gap-2 rounded-lg px-3.5 text-xs",
  lg: "h-11 gap-2 rounded-lg px-5 text-sm",
};

export function buttonClass(
  variant: ButtonVariant = "soft",
  size: ButtonSize = "md",
  extra = "",
) {
  const label = "font-medium tracking-[-0.01em]";
  return `inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40 ${label} ${SIZE[size]} ${VARIANT[variant]} ${extra}`;
}

export function Button({
  variant = "soft",
  size = "md",
  icon,
  children,
  className = "",
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={buttonClass(variant, size, className)}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  variant = "soft",
  size = "md",
  label,
  icon,
  className = "",
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  label: string;
  icon: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const box = size === "xs" ? "size-7" : size === "sm" ? "size-8" : "size-9";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-grid shrink-0 cursor-pointer place-items-center rounded-lg transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40 ${box} ${VARIANT[variant]} ${className}`}
    >
      {icon}
    </button>
  );
}
