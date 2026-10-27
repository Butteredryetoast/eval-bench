import hotMonitor from "../../modules/hot-monitor/web.tsx";
// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";

export const WEB_MODULES: readonly WebModule[] = [hotMonitor];
