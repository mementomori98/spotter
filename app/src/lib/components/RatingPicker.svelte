<script lang="ts">
  import { RATINGS, RATING_COLORS, RATING_HINTS, type Rating } from '$lib/util/rating';

  /**
   * The fixed --,-,+,++,+++ scale. Tap to set; tap the selected one again to
   * clear (back to unrated). One row, huge targets, zero extra taps.
   */
  let {
    value = null,
    onChange,
    compact = false,
    disabled = false
  }: {
    value: Rating | null;
    onChange: (r: Rating | null) => void;
    compact?: boolean;
    disabled?: boolean;
  } = $props();
</script>

<div class="rating" class:compact role="radiogroup" aria-label="Spot rating">
  {#each RATINGS as r (r)}
    <button
      type="button"
      role="radio"
      aria-checked={value === r}
      title={RATING_HINTS[r]}
      class:on={value === r}
      style:--rc={RATING_COLORS[r]}
      {disabled}
      onclick={() => onChange(value === r ? null : r)}
    >
      {r}
    </button>
  {/each}
</div>
{#if value}
  <p class="hint">{RATING_HINTS[value]} · tap again to clear</p>
{:else if !compact}
  <p class="hint">How good is this spot?</p>
{/if}

<style>
  .rating {
    display: flex;
    gap: 8px;
  }
  .hint {
    margin: 6px 2px 0;
    font-size: 13px;
    color: var(--ink-soft);
  }
  button {
    flex: 1;
    min-height: var(--tap);
    border-radius: var(--radius);
    border: 2px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    font-size: 19px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  button.on {
    border-color: var(--rc);
    background: var(--rc);
    color: #fff;
  }
  .compact button {
    min-height: 44px;
    font-size: 16px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
