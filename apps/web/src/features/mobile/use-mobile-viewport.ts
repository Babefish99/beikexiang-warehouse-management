import { useEffect, useState } from "react";
import { MOBILE_MEDIA_QUERY } from "./mobile-navigation";

export function useMobileViewport(): boolean {
  const [viewport, setViewport] = useState(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    return { media, mobile: media.matches };
  });

  useEffect(() => {
    const sync = () => setViewport({ media: viewport.media, mobile: viewport.media.matches });

    sync();
    viewport.media.addEventListener("change", sync);
    return () => viewport.media.removeEventListener("change", sync);
  }, [viewport.media]);

  return viewport.mobile;
}
