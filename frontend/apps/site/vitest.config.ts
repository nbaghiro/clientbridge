import { frozenClock } from "@clientbridge/config/vitest/config";
import { mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, frozenClock);
