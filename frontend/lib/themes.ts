export type ThemeId = "ghost" | "blood" | "toxic" | "cryo" | "venom" | "amber";

export interface Theme {
  id: ThemeId;
  name: string;
  tagline: string;
  accent: string;
  alert: string;
}

export const THEMES: Theme[] = [
  {
    id: "ghost",
    name: "Ghost",
    tagline: "Monochrome",
    accent: "#e8e8ee",
    alert: "#ff2d3d",
  },
  {
    id: "blood",
    name: "Blood",
    tagline: "Arterial red",
    accent: "#ff2d3d",
    alert: "#ffb02e",
  },
  {
    id: "toxic",
    name: "Toxic",
    tagline: "Radioactive green",
    accent: "#a6ff3d",
    alert: "#ff2e4d",
  },
  {
    id: "cryo",
    name: "Cryo",
    tagline: "Morgue-cold cyan",
    accent: "#3dd6ff",
    alert: "#ff2e6d",
  },
  {
    id: "venom",
    name: "Venom",
    tagline: "Ultraviolet",
    accent: "#b45cff",
    alert: "#ff4fd8",
  },
  {
    id: "amber",
    name: "Amber",
    tagline: "Sodium-lamp warning",
    accent: "#ffb020",
    alert: "#ff3d2e",
  },
];

export const DEFAULT_THEME: ThemeId = "ghost";

export const getTheme = (id: ThemeId) =>
  THEMES.find((t) => t.id === id) ?? THEMES[0];

export const SETTINGS_KEY = "wd-settings";
