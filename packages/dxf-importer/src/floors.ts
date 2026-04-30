/**
 * Multi-floor detection via Z-coordinate clustering.
 *
 * v1.1 helper: takes raw DXF entity Z-values and groups them into floor
 * clusters separated by gaps larger than `floorGapMeters`. The default
 * 2 metre gap matches typical floor-to-floor heights (2.7-4 m) while
 * tolerating sloped roofs and stair Z-spans on excluded layers.
 *
 * The current importer (v1) does NOT call this — it imports model space
 * to a single level. This module is exposed so a follow-up PR can add a
 * "this looks like 2 stacked floors — import as 2 levels?" prompt.
 */

export interface FloorCluster {
  /** Lower bound (inclusive) of the cluster's Z range, in source units. */
  zMin: number;
  /** Upper bound (inclusive) of the cluster's Z range, in source units. */
  zMax: number;
  /** Number of input Z-values that fell into this cluster. */
  count: number;
}

export interface FloorDetection {
  /** True when the input is definitively a single floor (flat z spread). */
  isSingleFloor: boolean;
  /** Detected clusters sorted ascending by zMin. Empty if no input. */
  clusters: FloorCluster[];
}

export interface FloorDetectionOptions {
  /** Minimum Z gap (in source units) that separates two distinct floors. Default 2 (metres). */
  floorGapMeters?: number;
  /** If the total Z spread is below this, the file is treated as flat 2D. Default 0.1. */
  flatThresholdMeters?: number;
  /**
   * When true (default), values are rounded to 4 decimals before clustering
   * to absorb floating-point jitter from CAD tools that round-trip Z values.
   */
  quantize?: boolean;
}

const DEFAULT_GAP = 2;
const DEFAULT_FLAT_THRESHOLD = 0.1;

/**
 * Group an array of Z-coordinates into floor clusters. Pure function — input
 * may come from any source (entities, INSERT positions, polyline elevations).
 */
export function detectFloorsFromZ(
  zValues: readonly number[],
  options: FloorDetectionOptions = {},
): FloorDetection {
  if (zValues.length === 0) {
    return { isSingleFloor: true, clusters: [] };
  }

  const gap = options.floorGapMeters ?? DEFAULT_GAP;
  const flatThreshold = options.flatThresholdMeters ?? DEFAULT_FLAT_THRESHOLD;
  const quantize = options.quantize ?? true;

  const cleaned: number[] = [];
  for (const z of zValues) {
    if (Number.isFinite(z)) {
      cleaned.push(quantize ? Math.round(z * 1e4) / 1e4 : z);
    }
  }
  if (cleaned.length === 0) {
    return { isSingleFloor: true, clusters: [] };
  }

  cleaned.sort((a, b) => a - b);
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first === undefined || last === undefined) {
    return { isSingleFloor: true, clusters: [] };
  }

  const totalSpread = last - first;
  if (totalSpread < flatThreshold) {
    return {
      isSingleFloor: true,
      clusters: [{ zMin: first, zMax: last, count: cleaned.length }],
    };
  }

  const clusters: FloorCluster[] = [];
  let clusterStart = first;
  let clusterEnd = first;
  let clusterCount = 1;

  for (let i = 1; i < cleaned.length; i++) {
    const z = cleaned[i];
    if (z === undefined) continue;
    const prev = cleaned[i - 1];
    if (prev === undefined) continue;
    if (z - prev > gap) {
      clusters.push({ zMin: clusterStart, zMax: clusterEnd, count: clusterCount });
      clusterStart = z;
      clusterCount = 1;
    } else {
      clusterCount += 1;
    }
    clusterEnd = z;
  }
  clusters.push({ zMin: clusterStart, zMax: clusterEnd, count: clusterCount });

  return {
    isSingleFloor: clusters.length <= 1,
    clusters,
  };
}
