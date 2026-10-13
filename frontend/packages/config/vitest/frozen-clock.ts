import { vi } from "vitest";

// The backend suite starts at the same instant (backend/tests/clock.py), so fixtures agree on today.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-13T17:00:00Z"));
