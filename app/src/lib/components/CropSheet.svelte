<script lang="ts">
  import BottomSheet from './BottomSheet.svelte';

  /**
   * Square crop for species icons: drag to position, slider (or wheel) to
   * zoom, live circular preview of exactly what the map marker will show.
   * Output: 128×128 JPEG blob.
   */
  let {
    open = $bindable(false),
    file,
    onDone
  }: { open: boolean; file: Blob | null; onDone: (cropped: Blob) => void } = $props();

  const VP = 280; // viewport css px
  const OUT = 128; // output px

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let img: ImageBitmap | null = null;
  let scale = $state(1);
  let minScale = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let ready = $state(false);

  $effect(() => {
    if (!open || !file) return;
    ready = false;
    let cancelled = false;
    void createImageBitmap(file).then((bitmap) => {
      if (cancelled) {
        bitmap.close();
        return;
      }
      img = bitmap;
      minScale = Math.max(VP / bitmap.width, VP / bitmap.height); // cover
      scale = minScale;
      tx = (VP - bitmap.width * scale) / 2;
      ty = (VP - bitmap.height * scale) / 2;
      ready = true;
      draw();
    });
    return () => {
      cancelled = true;
      img?.close();
      img = null;
    };
  });

  function clamp(): void {
    if (!img) return;
    tx = Math.min(0, Math.max(VP - img.width * scale, tx));
    ty = Math.min(0, Math.max(VP - img.height * scale, ty));
  }

  function draw(): void {
    const ctx = canvasEl?.getContext('2d');
    if (!ctx || !img) return;
    ctx.clearRect(0, 0, VP, VP);
    ctx.drawImage(img, tx, ty, img.width * scale, img.height * scale);
    // dim everything outside the final circle
    ctx.save();
    ctx.fillStyle = 'rgba(20,25,20,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, VP, VP);
    ctx.arc(VP / 2, VP / 2, VP / 2 - 2, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(VP / 2, VP / 2, VP / 2 - 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function setZoom(next: number): void {
    if (!img) return;
    const s = Math.min(minScale * 6, Math.max(minScale, next));
    // zoom around the viewport center
    const cx = VP / 2;
    const cy = VP / 2;
    tx = cx - ((cx - tx) / scale) * s;
    ty = cy - ((cy - ty) / scale) * s;
    scale = s;
    clamp();
    draw();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    clamp();
    draw();
  }
  function onPointerUp(): void {
    dragging = false;
  }

  async function done(): Promise<void> {
    if (!img) return;
    const out = document.createElement('canvas');
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext('2d')!;
    // JPEG has no alpha — transparent PNG areas must become white, not black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUT, OUT);
    const f = OUT / VP;
    ctx.drawImage(img, tx * f, ty * f, img.width * scale * f, img.height * scale * f);
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    );
    if (blob) {
      open = false;
      onDone(blob);
    }
  }
</script>

<BottomSheet bind:open title="Crop icon">
  <p class="note">Drag to position, zoom with the slider. The circle is what shows on the map.</p>
  <div class="stage">
    <canvas
      bind:this={canvasEl}
      width={VP}
      height={VP}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onwheel={(e) => {
        e.preventDefault();
        setZoom(scale * (e.deltaY < 0 ? 1.1 : 0.9));
      }}
    ></canvas>
  </div>
  <input
    type="range"
    min={minScale}
    max={minScale * 6}
    step={minScale / 50}
    value={scale}
    oninput={(e) => setZoom(+e.currentTarget.value)}
    aria-label="Zoom"
  />
  <button class="btn" onclick={() => void done()} disabled={!ready}>Use this icon</button>
</BottomSheet>

<style>
  .stage {
    display: flex;
    justify-content: center;
    margin-bottom: 12px;
  }
  canvas {
    border-radius: var(--radius);
    background: #222;
    touch-action: none; /* the canvas owns its gestures */
    max-width: 100%;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
    min-height: 44px;
    margin-bottom: 8px;
  }
  .btn {
    width: 100%;
  }
</style>
