import { AnimationClip } from "./AnimationClip";
export interface AnimationMarker {
  readonly time: number;
  readonly name: string;
}
export type AnimationEventListener = (
  marker: AnimationMarker,
  clip: number,
  direction: 1 | -1,
) => void;
/** Optional controller-owned events. Crossing windows exclude their starting endpoint. */
export class AnimationEvents {
  private readonly markers = new Map<number, readonly AnimationMarker[]>();
  private listeners: { callback: AnimationEventListener; active: boolean }[] =
    [];
  /** Initializes ordered clip markers and reusable event-dispatch state. */
  constructor(private readonly clips: readonly AnimationClip[]) {}
  /** Validates and sorts clip event markers before publishing the new event list. */
  set(clip: number, markers: readonly AnimationMarker[]): void {
    const data = this.clips[clip];
    if (
      !data ||
      markers.length > 1024 ||
      markers.some(
        (marker) =>
          /** Evaluates the !Number.isFinite(marker.time) || marker.time < 0 || marker.time > data.duration || !marker.name condition. */ !Number.isFinite(
            marker.time,
          ) ||
          marker.time < 0 ||
          marker.time > data.duration ||
          !marker.name,
      )
    )
      throw new Error("Invalid animation markers");
    this.markers.set(
      clip,
      Object.freeze(
        markers
          .map((marker) =>
            /** Delegates this operation to Object.freeze. */ Object.freeze({
              ...marker,
            }),
          )
          .sort(
            (a, b) =>
              /** Computes the a.time - b.time result. */ a.time - b.time,
          ),
      ),
    );
  }
  /** Registers a marker listener and returns a closure that removes it. */
  on(callback: AnimationEventListener): () => void {
    const listener = { callback, active: true };
    this.listeners = [...this.listeners, listener];
    return () => {
      // Deactivates and removes this marker listener without changing the current dispatch snapshot.

      listener.active = false;
      this.listeners = this.listeners.filter(
        (entry) =>
          /** Evaluates the entry !== listener condition. */ entry !== listener,
      );
    };
  }
  /** Dispatches markers crossed by playback, including clip wraps, in traversal order. */
  advance(clip: number, from: number, delta: number, loop: boolean): void {
    const markers = this.markers.get(clip);
    if (!markers?.length || !this.listeners.length || delta === 0) return;
    const duration = this.clips[clip]!.duration;
    if (duration === 0) return;
    const to = loop
      ? from + delta
      : Math.max(0, Math.min(duration, from + delta));
    const first = loop ? Math.floor(Math.min(from, to) / duration) - 1 : 0;
    const last = loop ? Math.floor(Math.max(from, to) / duration) : 0;
    // Fail explicitly rather than silently dropping events or allowing unbounded callback work.
    if ((last - first + 1) * markers.length > 4096)
      throw new Error("Animation event crossing budget exceeded");
    const listeners = this.listeners;
    const direction = delta > 0 ? 1 : -1;
    for (
      let cycle = direction > 0 ? first : last;
      direction > 0 ? cycle <= last : cycle >= first;
      cycle += direction
    ) {
      for (
        let i = direction > 0 ? 0 : markers.length - 1;
        direction > 0 ? i < markers.length : i >= 0;
        i += direction
      ) {
        const marker = markers[i]!,
          time = marker.time + cycle * duration;
        if (
          direction > 0 ? time <= from || time > to : time >= from || time < to
        )
          continue;
        for (const listener of listeners)
          if (listener.active) listener.callback(marker, clip, direction);
      }
    }
  }
}
