interface Listener {
  target: EventTarget;
  type: string;
  callback: EventListener;
  capture: boolean;
}
/** Cold listener ownership shared by DOM inputs. No listener arrays change during gameplay updates. */
export class InputScope {
  private readonly listeners: Listener[] = [];
  constructor(
    private readonly target: HTMLElement,
    clear: () => void,
    targetBlur = true,
  ) {
    if (targetBlur) this.add(target, "blur", clear);
    const document = target.ownerDocument;
    if (document?.defaultView) this.add(document.defaultView, "blur", clear);
    if (document)
      this.add(document, "visibilitychange", () => {
        if (document.visibilityState === "hidden") clear();
      });
  }
  listen<K extends keyof HTMLElementEventMap>(
    type: K,
    callback: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    this.add(this.target, type, callback as EventListener, options);
  }
  private add(
    target: EventTarget,
    type: string,
    callback: EventListener,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, callback, options);
    // Removal only matches capture, not passive/once. Keep exactly the registration's capture flag.
    this.listeners.push({
      target,
      type,
      callback,
      capture: options?.capture ?? false,
    });
  }
  dispose(): void {
    for (const listener of this.listeners)
      listener.target.removeEventListener(
        listener.type,
        listener.callback,
        listener.capture,
      );
    this.listeners.length = 0;
  }
}
