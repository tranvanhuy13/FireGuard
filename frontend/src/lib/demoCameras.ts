import { isMockData } from "./api/client";
import { computeDemoEnabled } from "./cameraView";

/**
 * Hard-coded demo cameras (public HLS streams), used only when
 * NEXT_PUBLIC_USE_DEMO_CAMERAS=true together with mock data.
 *
 * They are played in the browser with hls.js, so there is NO AI detection on them.
 * The first two are public test streams that normally allow browser playback;
 * the whatsupcams.com links may be blocked (CORS / hotlink protection) and then
 * the tile shows "MẤT KẾT NỐI". Replace or extend this list freely.
 */
export interface DemoCamera {
  id: number;
  name: string;
  source: string;
  is_active: boolean;
  status: "connected" | "connecting" | "disconnected";
}

/** Raw env flag. Do not use it directly in the UI: use DEMO_CAMERAS_ENABLED. */
export const USE_DEMO_CAMERAS = process.env.NEXT_PUBLIC_USE_DEMO_CAMERAS === "true";

/** Single source of truth for UI and mock service: demoEnabled = isMockData && USE_DEMO_CAMERAS. */
export const DEMO_CAMERAS_ENABLED = computeDemoEnabled(isMockData, USE_DEMO_CAMERAS);

const cam = (id: number, name: string, source: string, is_active = true): DemoCamera => ({
  id, name, source, is_active, status: is_active ? "connected" : "disconnected",
});

export const DEMO_CAMERAS: DemoCamera[] = [
  cam(1, "Demo - Big Buck Bunny (test)", "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"),
  cam(2, "Demo - Apple bipbop (test)", "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8"),
  cam(3, "Portorož Airport (Slovenia)", "https://cdn-004.whatsupcams.com/hls/si_ljpz1.m3u8"),
  cam(4, "Senj (Croatia)", "https://cdn-006.whatsupcams.com/hls/hr_senj12.m3u8"),
  cam(5, "Bibione Beach (Ý)", "https://cdn-007.whatsupcams.com/hls/it_bibione15.m3u8"),
  cam(6, "Cairo Pyramids (Ai Cập)", "https://cdn-03.whatsupcams.com/hls/eg_cairo01.m3u8"),
  cam(7, "Barban - Centar (Croatia)", "https://cdn-004.whatsupcams.com/hls/hr_barban01.m3u8"),
  cam(8, "Tkon - Yachthafen (Croatia)", "https://cdn-001.whatsupcams.com/hls/hr_tkon01.m3u8"),
  cam(9, "Gitschberg Jochtal (Ý)", "https://cdn-006.whatsupcams.com/hls/it_riopusteria02.m3u8"),
  cam(10, "Livigno (Ý)", "https://cdn-005.whatsupcams.com/hls/it_livigno04.m3u8"),
];

export const isHlsSource = (source: string) => /^https?:\/\/[^\s]+\.m3u8(\?.*)?$/i.test(source || "");
