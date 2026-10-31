import { useEffect, useState } from "react";

/** Current time in ms, 0 until mounted so server and client markup match. */
export function useNow(interval = 30_000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [interval]);
  return now;
}
