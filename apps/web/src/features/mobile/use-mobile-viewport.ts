import { useEffect, useState } from "react";
import { MOBILE_MEDIA_QUERY } from "./mobile-navigation";

export function getMobileViewportInitialValue(): boolean {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function subscribeToMobileViewport(update: (mobile: boolean) => void): () => void {
  const media = window.matchMedia(MOBILE_MEDIA_QUERY);
  const sync = () => update(media.matches);

  media.addEventListener("change", sync);
  return () => media.removeEventListener("change", sync);
}

export function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(getMobileViewportInitialValue);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    setMobile(media.matches);
    return subscribeToMobileViewport(setMobile);
  }, []);

  return mobile;
}
