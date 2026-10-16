/** Serialized game paths. XYZ stays in game units; only the SVG projection is scaled. */
export interface GamePath {
  distance: number;
  points: [number, number, number][];
  assetHash: string;
  sha256: string;
}
export interface CourseGeometry {
  path: GamePath;
  loop?: GamePath;
  asset: string;
}
export interface GeometryData {
  schemaVersion: 1;
  paths: Record<string, GamePath>;
  courses: Record<string, { path: string; loop?: string }>;
}
export interface PathPoint { distance: number; x: number; y: number; angle: number }

/** Reject a broken update as a whole, rather than drawing a partly valid route. */
export function readGeometry(value: unknown): GeometryData {
  const data = value as GeometryData;
  if (!data || data.schemaVersion !== 1 || !data.paths || !data.courses ||
      Array.isArray(data.paths) || Array.isArray(data.courses)) throw new Error('Invalid course geometry.');
  const paths = Object.values(data.paths);
  if (paths.length > 1000) throw new Error('Too many course paths.');
  for (const path of paths) {
    if (!path || !Number.isFinite(path.distance) || path.distance <= 0 || path.distance > 10000 ||
        !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 4097 ||
        path.points.some(p => !Array.isArray(p) || p.length !== 3 || p.some(n => !Number.isFinite(n) || Math.abs(n) > 100000))) {
      throw new Error('Invalid course path.');
    }
  }
  for (const binding of Object.values(data.courses)) {
    if (!binding || !data.paths[binding.path] || (binding.loop && !data.paths[binding.loop])) {
      throw new Error('Missing course path.');
    }
  }
  return data;
}

interface ProjectedCourse { route: PathPoint[]; outline: string }
const cache = new WeakMap<CourseGeometry, ProjectedCourse>();
function svgPath(points: {x: number; y: number}[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

export function projectGeometry(geometry: CourseGeometry): ProjectedCourse {
  const existing = cache.get(geometry); if (existing) return existing;
  const world = [...geometry.path.points, ...(geometry.loop?.points ?? [])];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, , z] of world) {
    minX = Math.min(minX, -x); maxX = Math.max(maxX, -x);
    minY = Math.min(minY, z); maxY = Math.max(maxY, z);
  }
  // Equal scale on both axes preserves the recovered curve radii and proportions.
  const scale = Math.min(850 / Math.max(1, maxX - minX), 290 / Math.max(1, maxY - minY));
  const project = ([x, , z]: number[]) => ({ x: 500 + (-x - (minX + maxX) / 2) * scale,
    y: 215 + (z - (minY + maxY) / 2) * scale });
  const points = geometry.path.points.map(project);
  const route = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    return { ...p, distance: geometry.path.distance * i / (points.length - 1), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  });
  // The full lap provides context for short races. Runner progress always follows
  // the distance-specific route, never distance modulo the separate lap length.
  const outline = (geometry.loop ? svgPath(geometry.loop.points.map(project)) + ' ' : '') + svgPath(points);
  const result = { route, outline }; cache.set(geometry, result); return result;
}
