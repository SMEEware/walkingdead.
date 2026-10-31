import { useEffect, useState } from "react";

import type { LogEvent } from "../types";
import type { DayKey } from "./day";
import { getDataSource } from "./index";
import type { DayStat, DaySummary } from "./types";

export function useDays(version: number) {
  const [days, setDays] = useState<DayStat[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    getDataSource()
      .listDays()
      .then((d) => {
        if (!alive) return;
        setDays(d);
        setLoaded(true);
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [version]);
  return { days, loaded };
}

export function useSummaries(version: number) {
  const [summaries, setSummaries] = useState<Map<DayKey, DaySummary>>(new Map());
  useEffect(() => {
    let alive = true;
    getDataSource()
      .listSummaries()
      .then((list) => alive && setSummaries(new Map(list.map((s) => [s.day, s]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [version]);
  return summaries;
}

export function useDayLogs(day: DayKey | null, version: number) {
  const [state, setState] = useState<{ day: DayKey | null; logs: LogEvent[] }>({ day: null, logs: [] });
  useEffect(() => {
    if (!day) return;
    let alive = true;
    getDataSource()
      .getDayLogs(day)
      .then((logs) => alive && setState({ day, logs }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [day, version]);
  // Rows from a previously selected day are never shown for the new selection.
  return { logs: state.day === day ? state.logs : [], loading: !!day && state.day !== day };
}
