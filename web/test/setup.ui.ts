// Global Vitest setup. Engine suites run under the plain node environment;
// UI suites opt into jsdom per-file via a `// @vitest-environment jsdom`
// pragma. Registering jest-dom matchers here is inert until a DOM matcher is
// used.
import "@testing-library/jest-dom/vitest";
