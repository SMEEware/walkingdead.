import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(Math.round(target));
  const current = useRef(target);
  const displayed = useRef(Math.round(target));

  useEffect(() => {
    const begin = current.current;
    if (begin === target) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    let raf = 0;

    const update = (next: number) => {
      current.current = next;
      const rounded = Math.round(next);
      if (rounded !== displayed.current) {
        displayed.current = rounded;
        setValue(rounded);
      }
    };
    const finish = () => {
      cancelAnimationFrame(raf);
      update(target);
    };
    const skipMotion = () => {
      if (document.hidden || motion.matches) finish();
    };
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      update(begin + (target - begin) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };

    if (duration <= 0 || document.hidden || motion.matches) {
      finish();
      return;
    }

    document.addEventListener("visibilitychange", skipMotion);
    motion.addEventListener("change", skipMotion);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", skipMotion);
      motion.removeEventListener("change", skipMotion);
    };
  }, [target, duration]);

  return value;
}
