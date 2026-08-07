import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver, but react-zoom-pan-pinch relies
// on it to size the wrapper on mount. Minimal no-op polyfill for tests.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom does not implement scrollIntoView; ConversationView calls it to
// auto-scroll the message list. Minimal no-op polyfill for tests.
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}
