"use client";

export function Switch({
  checked,
  onChange,
  label,
  size = "md",
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const dims = size === "sm" ? "h-5 w-9" : "h-6 w-11";
  const knob = size === "sm" ? "size-3.5" : "size-4.5";
  const shift = size === "sm" ? "translate-x-4" : "translate-x-5";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 items-center rounded-full border transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${dims} ${
        checked
          ? "border-accent/70 bg-accent"
          : "border-white/8 bg-white/8"
      }`}
    >
      <span
        className={`absolute left-0.5 rounded-full transition-all duration-300 ${knob} ${
          checked
            ? `${shift} bg-black/85 shadow-sm`
            : "translate-x-0 bg-zinc-500"
        }`}
      />
    </button>
  );
}
