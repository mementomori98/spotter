import { z } from 'zod';

/**
 * Entity payload schemas.
 *
 * Every syncable record is an "entity": an envelope (id, type, timestamps,
 * device id, tombstone flag) around a typed JSON payload. The server never
 * interprets payloads (except reading `hash` of photo entities for blob GC
 * and blob authorization) — the real schema lives here and is enforced by
 * both client and server with zod.
 */

export const EntityTypeSchema = z.enum(['spot', 'visit', 'photo', 'listItem']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

const uuid = z.string().min(8).max(64); // client-generated UUIDs (crypto.randomUUID)
const millis = z.number().int().nonnegative();

/** A host tree with an optional age range in years. */
export const HostTreeSchema = z.object({
  plantId: uuid,
  ageMin: z.number().int().min(0).max(5000).optional(),
  ageMax: z.number().int().min(0).max(5000).optional()
});
export type HostTree = z.infer<typeof HostTreeSchema>;

export const HabitatSchema = z.object({
  hostTrees: z.array(HostTreeSchema).default([]),
  soil: z.string().max(1000).default(''),
  vegetation: z.string().max(1000).default(''),
  /** Soil pH, 3.0–9.0 in 0.1 steps. */
  ph: z.number().min(3).max(9).optional(),
  surroundingPlantIds: z.array(uuid).default([]),
  indicatorSpeciesIds: z.array(uuid).default([]),
  habitatNotes: z.string().max(5000).default('')
});
export type Habitat = z.infer<typeof HabitatSchema>;

/** Fixed spot rating scale (product decision): how good is this spot? */
export const RATINGS = ['--', '-', '+', '++', '+++'] as const;
export type Rating = (typeof RATINGS)[number];
export const RatingSchema = z.enum(RATINGS);

export const SpotDataSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** GPS accuracy in meters at capture time, if known. */
  accuracy: z.number().nonnegative().optional(),
  /** Date & time of the original find (ms epoch). */
  foundAt: millis,
  /** Required by product decision (override of spots.md). */
  speciesId: uuid,
  /** Optional spot quality rating on the fixed scale. */
  rating: RatingSchema.optional(),
  notes: z.string().max(10000).default(''),
  habitat: HabitatSchema.default({
    hostTrees: [],
    soil: '',
    vegetation: '',
    surroundingPlantIds: [],
    indicatorSpeciesIds: [],
    habitatNotes: ''
  }),
  /** Photos of the mushroom itself (photo entity ids). */
  photoIds: z.array(uuid).default([]),
  /** Photos of the habitat (photo entity ids). */
  habitatPhotoIds: z.array(uuid).default([])
});
export type SpotData = z.infer<typeof SpotDataSchema>;

export const VisitOutcomeSchema = z.enum(['found', 'harvested', 'nothing']);
export type VisitOutcome = z.infer<typeof VisitOutcomeSchema>;

export const VisitDataSchema = z.object({
  spotId: uuid,
  /** Date & time of the visit (ms epoch). */
  at: millis,
  outcome: VisitOutcomeSchema,
  note: z.string().max(10000).default(''),
  photoIds: z.array(uuid).default([])
});
export type VisitData = z.infer<typeof VisitDataSchema>;

export const PhotoDataSchema = z.object({
  /** SHA-256 of the original file, lowercase hex. Content address of the blob. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Original file extension without dot, e.g. "jpg". */
  ext: z.string().min(1).max(10),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** EXIF DateTimeOriginal if present (ms epoch). */
  takenAt: millis.optional()
});
export type PhotoData = z.infer<typeof PhotoDataSchema>;

/**
 * Selector vocabulary item. Two shared vocabularies (spots.md):
 * - kind "species": mushroom species (species field + indicator mushrooms)
 * - kind "plant":   trees/plants (host trees + surrounding plants)
 */
export const ListItemDataSchema = z.object({
  kind: z.enum(['species', 'plant']),
  name: z.string().min(1).max(200),
  /** Drives the "recent 5" section of selectors. */
  lastUsedAt: millis.default(0),
  /**
   * Optional icon (species): id of a photo ENTITY holding the small cropped
   * image. Routed through a photo entity (not a bare hash) so the blob
   * syncs, exports and is GC-protected exactly like spot photos.
   */
  iconPhotoId: uuid.optional()
});
export type ListItemData = z.infer<typeof ListItemDataSchema>;

export const DataSchemaByType = {
  spot: SpotDataSchema,
  visit: VisitDataSchema,
  photo: PhotoDataSchema,
  listItem: ListItemDataSchema
} as const;

export type DataByType = {
  spot: SpotData;
  visit: VisitData;
  photo: PhotoData;
  listItem: ListItemData;
};

/** Full entity: envelope + payload. `data` is null iff `deleted` is true on the wire. */
export interface Entity<T extends EntityType = EntityType> {
  id: string;
  type: T;
  createdAt: number;
  updatedAt: number;
  /** Per-install device id; LWW tie-breaker. */
  updatedBy: string;
  deleted: boolean;
  data: DataByType[T] | null;
}

export type SpotEntity = Entity<'spot'> & { data: SpotData };
export type VisitEntity = Entity<'visit'> & { data: VisitData };
export type PhotoEntity = Entity<'photo'> & { data: PhotoData };
export type ListItemEntity = Entity<'listItem'> & { data: ListItemData };
