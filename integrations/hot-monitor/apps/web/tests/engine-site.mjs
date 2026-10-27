// Framework rendering tests use the base engine's routing. The installed site's
// redirects are covered separately by workspace-navigation.test.ts.
import { registerHooks } from "node:module";
const declaration = new URL("../../../site/modules/index.ts", import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url === declaration) return { format: "module", source: "export const MODULES = [];", shortCircuit: true };
    return nextLoad(url, context);
  },
});
