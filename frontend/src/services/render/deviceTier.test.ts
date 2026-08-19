import { describe, expect, it } from "vitest";
import { computeDeviceTier, type DeviceCapabilitySignals } from "./deviceTier";

const BASE_SIGNALS: DeviceCapabilitySignals = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  hardwareConcurrency: 8,
  deviceMemory: 8,
  maxTouchPoints: 0,
  viewportWidth: 1440,
  hasWebGL2: true,
  unmaskedRenderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
};

function signals(overrides: Partial<DeviceCapabilitySignals>): DeviceCapabilitySignals {
  return { ...BASE_SIGNALS, ...overrides };
}

describe("computeDeviceTier", () => {
  it("mobile UA -> T0, even with strong GPU/CPU/RAM signals", () => {
    const result = computeDeviceTier(
      signals({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        maxTouchPoints: 5,
        viewportWidth: 390,
      }),
    );
    expect(result).toBe("T0");
  });

  it("touch + narrow viewport (no mobile UA match) -> T0", () => {
    const result = computeDeviceTier(
      signals({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        maxTouchPoints: 5,
        viewportWidth: 500,
      }),
    );
    expect(result).toBe("T0");
  });

  it("no WebGL2 -> T0", () => {
    const result = computeDeviceTier(signals({ hasWebGL2: false }));
    expect(result).toBe("T0");
  });

  it("software renderer string -> T0", () => {
    const result = computeDeviceTier(
      signals({ unmaskedRenderer: "Google SwiftShader" }),
    );
    expect(result).toBe("T0");
  });

  it("llvmpipe software renderer -> T0", () => {
    const result = computeDeviceTier(
      signals({ unmaskedRenderer: "llvmpipe (LLVM 12.0.0, 256 bits)" }),
    );
    expect(result).toBe("T0");
  });

  it("low core count -> T0", () => {
    const result = computeDeviceTier(signals({ hardwareConcurrency: 2 }));
    expect(result).toBe("T0");
  });

  it("low deviceMemory (when present) -> T0", () => {
    const result = computeDeviceTier(signals({ deviceMemory: 2 }));
    expect(result).toBe("T0");
  });

  it("missing hardwareConcurrency -> T0 (fail safe)", () => {
    const result = computeDeviceTier(signals({ hardwareConcurrency: undefined }));
    expect(result).toBe("T0");
  });

  it("integrated GPU string -> T1", () => {
    const result = computeDeviceTier(
      signals({ unmaskedRenderer: "Intel(R) UHD Graphics 620" }),
    );
    expect(result).toBe("T1");
  });

  it("Intel HD string -> T1", () => {
    const result = computeDeviceTier(signals({ unmaskedRenderer: "Intel HD Graphics 4000" }));
    expect(result).toBe("T1");
  });

  it("missing deviceMemory -> capped at T1, never auto-promoted to T2", () => {
    const result = computeDeviceTier(
      signals({ deviceMemory: undefined, hardwareConcurrency: 16 }),
    );
    expect(result).toBe("T1");
  });

  it("strong signals (>=8 cores, >=8GB RAM, real GPU) -> T2-eligible", () => {
    const result = computeDeviceTier(signals({}));
    expect(result).toBe("T2");
  });

  it("strong static signals but slow microbench -> demoted to T1", () => {
    const result = computeDeviceTier(signals({ microbenchMs: 20 }));
    expect(result).toBe("T1");
  });

  it("strong static signals and fast microbench -> confirmed T2", () => {
    const result = computeDeviceTier(signals({ microbenchMs: 4 }));
    expect(result).toBe("T2");
  });

  it("6 cores, 4GB RAM -> T1 (not T2-eligible)", () => {
    const result = computeDeviceTier(signals({ hardwareConcurrency: 6, deviceMemory: 4 }));
    expect(result).toBe("T1");
  });

  it("thrown error while reading a signal getter fails safe to T0", () => {
    const throwing: DeviceCapabilitySignals = {
      ...BASE_SIGNALS,
      get unmaskedRenderer(): never {
        throw new Error("boom");
      },
    } as unknown as DeviceCapabilitySignals;

    expect(computeDeviceTier(throwing)).toBe("T0");
  });
});
