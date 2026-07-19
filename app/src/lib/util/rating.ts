import { RATINGS, type Rating } from '@spots/shared';

export { RATINGS, type Rating };

/**
 * One shared visual language for ratings, used by map pins, list badges and
 * the picker: color runs from gray (worthless) through greens to gold
 * (excellent), and map pins additionally grow with the rating.
 */
export const RATING_COLORS: Record<Rating, string> = {
  '--': '#9e9e9e',
  '-': '#b08968',
  '+': '#7cb342',
  '++': '#2e7d32',
  '+++': '#ffb300'
};

/** Pin color for spots without a rating. */
export const UNRATED_COLOR = '#c62828';

/** Map pin radius multiplier per rating (better spots are bigger). */
export const RATING_SIZE: Record<Rating, number> = {
  '--': 0.75,
  '-': 0.85,
  '+': 1.0,
  '++': 1.15,
  '+++': 1.35
};

export const RATING_HINTS: Record<Rating, string> = {
  '--': 'Worthless',
  '-': 'Poor',
  '+': 'OK',
  '++': 'Good',
  '+++': 'Excellent'
};
