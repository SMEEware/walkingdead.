import type { DayKey } from "./data/day";

export interface Selection {
  day?: DayKey;
  focusId?: string;
  open?: "notifications" | "palette";
}

let current: Selection = {};

export const setSelection = (patch: Selection) => {
  current = { ...current, ...patch };
};

/** Reads the pending selection without clearing it (safe to call during render). */
export const peekSelection = (): Selection => current;

export const clearSelection = () => {
  current = {};
};
