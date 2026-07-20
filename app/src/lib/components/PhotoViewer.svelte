<script lang="ts">
  import { fade } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import PhotoImg from './PhotoImg.svelte';

  /**
   * Dependency-free zoom lightbox: pinch/wheel zooms at the focal point,
   * one finger pans (clamped to the image), double-tap toggles 2.5x, single
   * tap / X / Escape closes. Parent renders it conditionally.
   */
  let {
    photoId = null,
    hash = null,
    ext = null,
    alt = 'Photo',
    onClose
  }: {
    photoId?: string | null;
    hash?: string | null;
    ext?: string | null;
    alt?: string;
    onClose: () => void;
  } = $props();

  // One window for everything tap-related: max press length, double-tap
  // window and the single-tap close delay — keeping them equal is what makes
  // "second tap always cancels the pending close" race-free.
  const DOUBLE_TAP_MS = 300;

  let lightboxEl = $state<HTMLDivElement | null>(null);
  let closeBtn = $state<HTMLButtonElement | null>(null);

  let s = $state(1); // scale, clamped to [1, 5]
  let tx = $state(0);
  let ty = $state(0);
  let anim = $state(false); // transition transform only for programmatic zoom

  // Contain-fitted image size inside the untransformed stage. The clamp math
  // must use this, not the natural size — object-fit letterboxes the img.
  let naturalW = 0;
  let naturalH = 0;
  let fitW = 0;
  let fitH = 0;

  function measure(img: HTMLImageElement): void {
    naturalW = img.naturalWidth;
    naturalH = img.naturalHeight;
    layout();
  }

  function layout(): void {
    if (!lightboxEl || !naturalW || !naturalH) return;
    const k = Math.min(lightboxEl.clientWidth / naturalW, lightboxEl.clientHeight / naturalH);
    fitW = naturalW * k;
    fitH = naturalH * k;
    clampPan(); // a resize can leave the pan pointing past the image edge
  }

  /**
   * object-fit centers the image inside the scaled stage by off = s·(view −
   * fitted)/2, so it visibly spans [off + t, off + t + fitted·s]. Larger than
   * the viewport: clamp t so no gap shows past either edge. Smaller: center
   * it — which at s = 1 yields exactly 0.
   */
  function clampAxis(t: number, view: number, fitted: number): number {
    const off = (s * (view - fitted)) / 2;
    if (fitted * s <= view) return (view * (1 - s)) / 2;
    return Math.min(-off, Math.max(view - off - fitted * s, t));
  }

  function clampPan(): void {
    if (!lightboxEl) return;
    tx = clampAxis(tx, lightboxEl.clientWidth, fitW);
    ty = clampAxis(ty, lightboxEl.clientHeight, fitH);
  }

  /** Zoom by factor keeping the viewport point (fx, fy) fixed on the image. */
  function zoomAt(fx: number, fy: number, factor: number): void {
    if (!fitW) return; // not measured yet — zooming the placeholder is nonsense
    const next = Math.min(5, Math.max(1, s * factor));
    const f = next / s;
    tx = fx - f * (fx - tx);
    ty = fy - f * (fy - ty);
    s = next;
    clampPan();
  }

  // Per-pointer last positions: deltas always come from the moved pointer's
  // own entry, so a pinch dropping to one finger resumes panning from the
  // survivor's own last point — no jump.
  const pointers = new Map<number, { x: number; y: number }>();
  let gestureMulti = false; // gesture ever had 2 pointers → never a tap
  let downTime = 0;
  let totalMove = 0;
  let downNearLastTap = false;
  let lastTapUp: { t: number; x: number; y: number } | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelClose(): void {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    // Unconditionally: a fumbled pinch's second finger (or a double-tap's
    // second tap) must never let a stale single-tap timer close the viewer.
    cancelClose();
    anim = false;
    // Capture so moves/ups keep arriving even when the finger leaves the
    // element — a stuck pointer entry is otherwise possible.
    lightboxEl?.setPointerCapture(e.pointerId);
    if (pointers.size >= 2) return; // 3rd+ fingers are ignored entirely
    if (pointers.size === 0) {
      gestureMulti = false;
      totalMove = 0;
      downTime = e.timeStamp;
      downNearLastTap =
        lastTapUp !== null &&
        e.timeStamp - lastTapUp.t < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - lastTapUp.x, e.clientY - lastTapUp.y) < 40;
    } else {
      gestureMulti = true;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (!p) return; // close-button downs and ignored fingers never made it in
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const prevDist = Math.hypot(a.x - b.x, a.y - b.y);
      const prevMidX = (a.x + b.x) / 2;
      const prevMidY = (a.y + b.y) / 2;
      p.x = e.clientX; // p is a or b — updating it in place updates the Map
      p.y = e.clientY;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (prevDist > 0) zoomAt(midX, midY, dist / prevDist);
      // two-finger drag also pans, by the midpoint delta
      tx += midX - prevMidX;
      ty += midY - prevMidY;
      clampPan();
      return;
    }
    totalMove += Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (s > 1) {
      tx += e.clientX - p.x;
      ty += e.clientY - p.y;
      clampPan();
    }
    p.x = e.clientX;
    p.y = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) return;
    const isTap = !gestureMulti && totalMove < 10 && e.timeStamp - downTime < DOUBLE_TAP_MS;
    if (!isTap) return;
    if (downNearLastTap) {
      lastTapUp = null; // a triple tap starts a fresh double, not a re-toggle
      anim = true; // animate only this programmatic jump; next pointerdown clears it
      zoomAt(e.clientX, e.clientY, s > 1 ? 1 / s : 2.5);
    } else {
      lastTapUp = { t: e.timeStamp, x: e.clientX, y: e.clientY };
      // Wait out the double-tap window before closing so the first tap of a
      // double-tap doesn't dismiss the viewer; any pointerdown cancels this.
      if (s === 1) closeTimer = setTimeout(onClose, DOUBLE_TAP_MS);
    }
  }

  // Svelte 5 registers the element `onwheel` attribute passively, which would
  // make preventDefault a no-op — attach by hand to actually stop page scroll.
  $effect(() => {
    const el = lightboxEl;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      anim = false; // wheel ticks must not run through the double-tap transition
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  $effect(() => {
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    // Save/restore instead of clearing so this nests inside BottomSheet's
    // own scroll lock (viewer opened from a sheet must not unlock the sheet).
    document.body.style.overflow = 'hidden';
    closeBtn?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      cancelClose(); // Escape/X during the close delay must not re-fire onClose
      if (prevFocus instanceof HTMLElement) prevFocus.focus();
    };
  });
</script>

<svelte:window onresize={layout} onkeydown={(e) => e.key === 'Escape' && onClose()} />

<div
  bind:this={lightboxEl}
  class="lightbox"
  transition:fade={{ duration: 150 }}
  role="dialog"
  aria-modal="true"
  aria-label={alt}
  tabindex="-1"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={(e) => {
    // A browser-initiated cancel (system dialog, gesture steal) is never a
    // tap — it must not close the viewer or trigger a double-tap zoom.
    gestureMulti = true;
    onPointerUp(e);
  }}
>
  <div class="stage" class:anim style="transform: translate({tx}px, {ty}px) scale({s})">
    <PhotoImg {photoId} {hash} {ext} {alt} fit="contain" onLoad={measure} />
  </div>
  <button
    bind:this={closeBtn}
    type="button"
    class="close"
    aria-label="Close photo"
    onpointerdown={(e) => e.stopPropagation()}
    onclick={onClose}
  >
    <Icon name="x" />
  </button>
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 80; /* above sheets (60/61) and dialogs (70/71), below banner (90) / toasts (100) */
    background: rgba(0, 0, 0, 0.92);
    touch-action: none; /* the lightbox owns its gestures */
    user-select: none;
    overflow: hidden;
  }
  .stage {
    position: absolute;
    inset: 0;
    pointer-events: none; /* all gestures land on the lightbox itself */
    transform-origin: 0 0;
  }
  .stage.anim {
    transition: transform 0.2s ease;
  }
  .close {
    position: absolute;
    top: calc(8px + env(safe-area-inset-top, 0px));
    right: 8px;
    width: 56px;
    height: 56px;
    border: none;
    background: none;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
</style>
