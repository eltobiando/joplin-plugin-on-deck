import { vi } from "vitest";

// Mock of Joplin's `api` module for unit tests. vitest.config.mts aliases
// `api` here so plugin code imports this instead of the real (Joplin-host-
// only) API. Tests replace the vi.fn() stubs per-test to script behavior.
const joplinMock = {
  data: {
    get: vi.fn(),
    put: vi.fn(),
  },
  commands: {
    execute: vi.fn(),
  },
  plugins: {
    installationDir: vi.fn(),
  },
  settings: {
    value: vi.fn(),
    values: vi.fn(),
    setValue: vi.fn(),
    globalValues: vi.fn(),
  },
};

export default joplinMock;
