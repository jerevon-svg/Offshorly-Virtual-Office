// vo3d env — THE MANUAL WEATHER PROVIDER. The dev source the visual proof runs on.
//
// It exists so that the provider seam is exercised by real code rather than left as an unused interface:
// the environment consumes a WeatherProvider, and this is a WeatherProvider. The day a real service is
// approved, it is swapped for that one and nothing downstream changes.
//
// It reaches no network, reads no key and has no configuration.
import type { WeatherObservation, WeatherProvider, WeatherState } from "../weather";

export class ManualWeatherProvider implements WeatherProvider {
  readonly id = "manual";
  readonly label = "manual (dev)";
  state: WeatherState;
  intensity: number;

  constructor(state: WeatherState = "clear", intensity = 1) {
    this.state = state;
    this.intensity = intensity;
  }
  read(): Promise<WeatherObservation> {
    return Promise.resolve({ state: this.state, intensity: this.intensity, label: `manual · ${this.state}`, observedAt: Date.now() });
  }
}
