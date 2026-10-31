import { HttpDataSource } from "./http";
import type { DataSource } from "./types";

let instance: DataSource | null = null;

export function getDataSource(): DataSource {
  if (instance) return instance;
  instance = new HttpDataSource();
  return instance;
}
