import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// unmount every rendered hook so React's scheduler never runs after the test environment closes
afterEach(cleanup);
