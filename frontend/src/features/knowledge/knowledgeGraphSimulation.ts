export type GraphForces = {
  center: number;
  repel: number;
  link: number;
  distance: number;
};

export type SimulationNode = { id: number; x: number; y: number };
export type SimulationLink = { source: number; target: number };

export const DEFAULT_GRAPH_FORCES: GraphForces = { center: 0.5, repel: 10, link: 1, distance: 100 };

export type KnowledgeGraphSimulation = {
  update: (nodes: SimulationNode[], links: SimulationLink[]) => void;
  setForces: (forces: GraphForces) => void;
  pin: (id: number, x: number, y: number) => void;
  release: (id: number) => void;
  reheat: () => void;
  stop: () => void;
  destroy: () => void;
};

type Particle = SimulationNode & { vx: number; vy: number; pinned: boolean; degree: number };
type Spring = { source: Particle; target: Particle };
type Quad = {
  x: number;
  y: number;
  size: number;
  mass: number;
  cx: number;
  cy: number;
  particles: Particle[] | null;
  children: (Quad | null)[] | null;
};

const FRAME_MS = 1000 / 30;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const THETA_SQUARED = 0.8 ** 2;
const MIN_DISTANCE_SQUARED = 12 ** 2;

function bounded(value: number, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function normalizeForces(forces: GraphForces): GraphForces {
  return {
    center: bounded(forces.center, DEFAULT_GRAPH_FORCES.center, 0, 5),
    repel: bounded(forces.repel, DEFAULT_GRAPH_FORCES.repel, 0, 500),
    link: bounded(forces.link, DEFAULT_GRAPH_FORCES.link, 0, 5),
    distance: bounded(forces.distance, DEFAULT_GRAPH_FORCES.distance, 10, 1000),
  };
}

function makeQuad(x: number, y: number, size: number): Quad {
  return { x, y, size, mass: 0, cx: 0, cy: 0, particles: [], children: null };
}

function insertQuad(quad: Quad, particle: Particle, depth = 0) {
  if (quad.children) {
    const half = quad.size / 2;
    const right = particle.x >= quad.x + half ? 1 : 0;
    const bottom = particle.y >= quad.y + half ? 1 : 0;
    const index = right + bottom * 2;
    const child = quad.children[index] ?? (quad.children[index] = makeQuad(quad.x + right * half, quad.y + bottom * half, half));
    insertQuad(child, particle, depth + 1);
    return;
  }
  const bucket = quad.particles!;
  // A bounded-depth bucket also handles genuinely coincident pinned nodes.
  if (bucket.length < 4 || depth >= 20 || quad.size < 0.001) {
    bucket.push(particle);
    return;
  }
  quad.children = [null, null, null, null];
  quad.particles = null;
  for (const existing of bucket) insertQuad(quad, existing, depth);
  insertQuad(quad, particle, depth);
}

function weighQuad(quad: Quad) {
  let x = 0;
  let y = 0;
  if (quad.children) {
    for (const child of quad.children) {
      if (!child) continue;
      weighQuad(child);
      quad.mass += child.mass;
      x += child.cx * child.mass;
      y += child.cy * child.mass;
    }
  } else {
    for (const particle of quad.particles!) {
      quad.mass += 1;
      x += particle.x;
      y += particle.y;
    }
  }
  quad.cx = x / (quad.mass || 1);
  quad.cy = y / (quad.mass || 1);
}

function buildQuad(particles: Particle[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const particle of particles) {
    minX = Math.min(minX, particle.x);
    minY = Math.min(minY, particle.y);
    maxX = Math.max(maxX, particle.x);
    maxY = Math.max(maxY, particle.y);
  }
  const size = Math.max(1, maxX - minX, maxY - minY) * 1.001;
  const root = makeQuad(minX - 0.0001, minY - 0.0001, size);
  for (const particle of particles) insertQuad(root, particle);
  weighQuad(root);
  return root;
}

function separateCoincidence(a: number, b: number) {
  const angle = ((Math.min(a, b) * 31 + Math.max(a, b) * 17) % 997) * GOLDEN_ANGLE;
  const sign = a < b ? 1 : -1;
  return { x: Math.cos(angle) * sign, y: Math.sin(angle) * sign };
}

function repelFromQuad(particle: Particle, quad: Quad, strength: number) {
  if (quad.mass === 0) return;
  let dx = particle.x - quad.cx;
  let dy = particle.y - quad.cy;
  const distanceSquared = dx * dx + dy * dy;
  if (quad.children) {
    const containsParticle = particle.x >= quad.x && particle.x <= quad.x + quad.size
      && particle.y >= quad.y && particle.y <= quad.y + quad.size;
    // Never approximate a cell containing this particle, which would include
    // self-repulsion. Distant clusters contribute one Barnes-Hut interaction.
    if (!containsParticle && quad.size * quad.size < THETA_SQUARED * distanceSquared) {
      const force = strength * quad.mass / Math.max(MIN_DISTANCE_SQUARED, distanceSquared);
      particle.vx += dx * force;
      particle.vy += dy * force;
      return;
    }
    for (const child of quad.children) if (child) repelFromQuad(particle, child, strength);
    return;
  }
  for (const other of quad.particles!) {
    if (other === particle) continue;
    dx = particle.x - other.x;
    dy = particle.y - other.y;
    let separationSquared = dx * dx + dy * dy;
    if (separationSquared < 0.000001) {
      const separation = separateCoincidence(particle.id, other.id);
      dx = separation.x;
      dy = separation.y;
      separationSquared = 1;
    }
    const force = strength / Math.max(MIN_DISTANCE_SQUARED, separationSquared);
    particle.vx += dx * force;
    particle.vy += dy * force;
  }
}

/**
 * A cooling, two-dimensional force simulation in graph coordinates. Rendering
 * stays with the caller; no Cytoscape, DOM, worker, or persistence is required.
 * Every public mutation reheats a stopped simulation except stop/destroy.
 */
export function createKnowledgeGraphSimulation(options: {
  nodes: SimulationNode[];
  links: SimulationLink[];
  forces: GraphForces;
  onTick: (positions: SimulationNode[]) => void;
  onEnd?: () => void;
}): KnowledgeGraphSimulation {
  let particles: Particle[] = [];
  let particlesById = new Map<number, Particle>();
  let springs: Spring[] = [];
  let forces = normalizeForces(options.forces);
  let onTick: typeof options.onTick | null = options.onTick;
  let onEnd: typeof options.onEnd | null = options.onEnd;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let running = false;
  let alpha = 1;
  let stillFrames = 0;
  let centerX = 0;
  let centerY = 0;

  function stop() {
    running = false;
    if (timer != null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    if (destroyed || !running || timer != null || particles.length === 0) return;
    timer = setTimeout(tick, FRAME_MS);
  }

  function reheat() {
    if (destroyed || particles.length === 0) return;
    alpha = 1;
    stillFrames = 0;
    running = true;
    schedule();
  }

  function update(nodes: SimulationNode[], links: SimulationLink[]) {
    if (destroyed) return;
    const nextById = new Map<number, Particle>();
    const occupied = new Set<string>();
    particles = [];
    for (const node of nodes) {
      if (!Number.isFinite(node.id) || nextById.has(node.id)) continue;
      const previous = particlesById.get(node.id);
      const angle = particles.length * GOLDEN_ANGLE;
      const radius = 9 * Math.sqrt(particles.length + 1);
      let x = Number.isFinite(node.x) ? node.x : centerX + Math.cos(angle) * radius;
      let y = Number.isFinite(node.y) ? node.y : centerY + Math.sin(angle) * radius;
      const coordinateKey = `${x}:${y}`;
      if (!previous?.pinned && occupied.has(coordinateKey)) {
        x += Math.cos(angle) * radius;
        y += Math.sin(angle) * radius;
      }
      occupied.add(coordinateKey);
      const particle: Particle = {
        id: node.id,
        x: previous?.pinned ? previous.x : x,
        y: previous?.pinned ? previous.y : y,
        vx: previous?.vx ?? 0,
        vy: previous?.vy ?? 0,
        pinned: previous?.pinned ?? false,
        degree: 0,
      };
      particles.push(particle);
      nextById.set(particle.id, particle);
    }
    particlesById = nextById;
    springs = [];
    for (const link of links) {
      const source = particlesById.get(link.source);
      const target = particlesById.get(link.target);
      if (!source || !target || source === target) continue;
      source.degree += 1;
      target.degree += 1;
      springs.push({ source, target });
    }
    // Keep the original graph's visual center rather than pulling an existing
    // canvas abruptly to world origin when its simulation is first enabled.
    if (particles.length > 0) {
      centerX = particles.reduce((total, particle) => total + particle.x, 0) / particles.length;
      centerY = particles.reduce((total, particle) => total + particle.y, 0) / particles.length;
    }
    if (particles.length === 0) stop();
    else reheat();
  }

  function tick() {
    timer = null;
    if (destroyed || !running || particles.length === 0) return;
    if (forces.repel > 0) {
      const tree = buildQuad(particles);
      const strength = forces.repel * 2.4 * alpha;
      for (const particle of particles) if (!particle.pinned) repelFromQuad(particle, tree, strength);
    }
    const centerStrength = forces.center * 0.02 * alpha;
    for (const particle of particles) {
      if (particle.pinned) continue;
      particle.vx += (centerX - particle.x) * centerStrength;
      particle.vy += (centerY - particle.y) * centerStrength;
    }
    for (const { source, target } of springs) {
      if (source.pinned && target.pinned) continue;
      let dx = target.x + target.vx - source.x - source.vx;
      let dy = target.y + target.vy - source.y - source.vy;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.000001) {
        const separation = separateCoincidence(source.id, target.id);
        dx = separation.x;
        dy = separation.y;
        distance = 1;
      }
      const strength = (distance - forces.distance) / distance * forces.link * 0.18 * alpha
        / Math.max(1, Math.min(source.degree, target.degree));
      const sourceShare = target.pinned ? 1 : target.degree / (source.degree + target.degree);
      const targetShare = source.pinned ? 1 : source.degree / (source.degree + target.degree);
      if (!source.pinned) {
        source.vx += dx * strength * sourceShare;
        source.vy += dy * strength * sourceShare;
      }
      if (!target.pinned) {
        target.vx -= dx * strength * targetShare;
        target.vy -= dy * strength * targetShare;
      }
    }
    let maximumSpeed = 0;
    for (const particle of particles) {
      if (particle.pinned) {
        particle.vx = 0;
        particle.vy = 0;
        continue;
      }
      particle.vx *= 0.78;
      particle.vy *= 0.78;
      const speed = Math.hypot(particle.vx, particle.vy);
      if (speed > 36) {
        particle.vx *= 36 / speed;
        particle.vy *= 36 / speed;
      }
      maximumSpeed = Math.max(maximumSpeed, Math.min(36, speed));
      particle.x += particle.vx;
      particle.y += particle.vy;
    }
    alpha *= 0.975;
    stillFrames = alpha < 0.02 && maximumSpeed < 0.12 ? stillFrames + 1 : 0;
    onTick?.(particles.map(({ id, x, y }) => ({ id, x, y })));
    if (destroyed || !running) return;
    if (stillFrames >= 4) {
      stop();
      onEnd?.();
      return;
    }
    schedule();
  }

  update(options.nodes, options.links);

  return {
    update,
    setForces(next) {
      if (destroyed) return;
      const normalized = normalizeForces(next);
      if (Object.keys(forces).every((key) => forces[key as keyof GraphForces] === normalized[key as keyof GraphForces])) return;
      forces = normalized;
      reheat();
    },
    pin(id, x, y) {
      const particle = particlesById.get(id);
      if (destroyed || !particle || !Number.isFinite(x) || !Number.isFinite(y)) return;
      particle.x = x;
      particle.y = y;
      particle.vx = 0;
      particle.vy = 0;
      particle.pinned = true;
      reheat();
    },
    release(id) {
      const particle = particlesById.get(id);
      if (destroyed || !particle) return;
      particle.pinned = false;
      reheat();
    },
    reheat,
    stop,
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      particles = [];
      particlesById.clear();
      springs = [];
      onTick = null;
      onEnd = null;
    },
  };
}
