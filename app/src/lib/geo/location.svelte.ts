/**
 * Live GPS + compass heading. watchPosition runs while the app is open so a
 * fix is usually already available when the capture form opens; the last
 * known position seeds the pin instantly (canopy fixes can take a minute).
 */
class LocationState {
  lat = $state<number | null>(null);
  lng = $state<number | null>(null);
  accuracy = $state<number | null>(null);
  /** Compass heading 0-360 (deviceorientationabsolute), null when unsupported. */
  heading = $state<number | null>(null);
  error = $state<string | null>(null);
  private watchId: number | null = null;

  start(): void {
    if (this.watchId !== null || !('geolocation' in navigator)) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.lat = pos.coords.latitude;
        this.lng = pos.coords.longitude;
        this.accuracy = pos.coords.accuracy;
        this.error = null;
      },
      (err) => {
        this.error = err.code === err.PERMISSION_DENIED ? 'Location permission denied' : null;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );

    // Android Chrome: no permission prompt needed; feature-detected.
    window.addEventListener('deviceorientationabsolute', (ev) => {
      const e = ev as DeviceOrientationEvent;
      if (e.absolute && e.alpha !== null) {
        const screenAngle =
          (screen.orientation?.angle ?? 0) as number;
        this.heading = (360 - e.alpha + screenAngle) % 360;
      }
    });
  }

  get hasFix(): boolean {
    return this.lat !== null && this.lng !== null;
  }
}

export const location = new LocationState();
