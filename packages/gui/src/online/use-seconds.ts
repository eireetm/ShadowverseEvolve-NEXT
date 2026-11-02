import { useEffect, useState } from "react";

/** Seconds since `since`, updated every second (for "still looking" hints). */
export function useSeconds(since: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}
