// Reader for Gmsh .msh files: MSH 2.2 and 4.1, ASCII and binary.
//
// parseMsh(buffer) returns the surfaces to draw. For a volume mesh that is the boundary
// of each element group (the faces that belong to a single element of the group); for a
// surface-only mesh it is the surface elements themselves. Groups are physical groups
// when the file has them (MSH 2), otherwise geometric entities. Higher-order elements are
// drawn by their corner nodes. Plain module with no three.js dependency.

// Gmsh element type -> [shape, number of nodes].
const TYPES = {
  1: ['line', 2], 2: ['tri', 3], 3: ['quad', 4], 4: ['tet', 4], 5: ['hex', 8], 6: ['prism', 6],
  7: ['pyramid', 5], 8: ['line', 3], 9: ['tri', 6], 10: ['quad', 9], 11: ['tet', 10], 12: ['hex', 27],
  13: ['prism', 18], 14: ['pyramid', 14], 15: ['point', 1], 16: ['quad', 8], 17: ['hex', 20],
  18: ['prism', 15], 19: ['pyramid', 13], 20: ['tri', 9], 21: ['tri', 10], 22: ['tri', 12],
  23: ['tri', 15], 24: ['tri', 15], 25: ['tri', 21], 26: ['line', 4], 27: ['line', 5], 28: ['line', 6],
  29: ['tet', 20], 30: ['tet', 35], 31: ['tet', 56], 92: ['hex', 64], 93: ['hex', 125],
};
const MAX_NODES = 125;

// Faces of each shape as corner indices in Gmsh node order; lines and points have none.
const FACES = {
  tri: [[0, 1, 2]],
  quad: [[0, 1, 2, 3]],
  tet: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
  hex: [[0, 3, 2, 1], [0, 1, 5, 4], [0, 4, 7, 3], [1, 2, 6, 5], [2, 3, 7, 6], [4, 5, 6, 7]],
  prism: [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [0, 3, 5, 2], [1, 2, 5, 4]],
  pyramid: [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
};
const CORNERS = { tri: 3, quad: 4, tet: 4, hex: 8, prism: 6, pyramid: 5 };
const DIM = { tri: 2, quad: 2, tet: 3, hex: 3, prism: 3, pyramid: 3 };
const SHAPE_NAMES = {
  tet: 'Tetrahedra', hex: 'Hexahedra', prism: 'Prisms', pyramid: 'Pyramids',
  tri: 'Triangles', quad: 'Quads', line: 'Lines', point: 'Points',
};

export function parseMsh(buffer) {
  try {
    return parse(new Reader(buffer));
  } catch (err) {
    // DataView reads past the end of a truncated binary file.
    if (err instanceof RangeError) throw new Error('The .msh file is truncated or corrupt');
    throw err;
  }
}

function parse(r) {
  let name = null;
  try { name = r.section(); } catch { /* not a section header */ }
  if (name !== 'MeshFormat') throw new Error('Not a Gmsh mesh (no $MeshFormat header)');

  const [version, fileType, dataSize] = r.line().split(/\s+/);
  const v = parseFloat(version);
  if (!(Math.floor(v) === 2 || v >= 4.1 && v < 5)) {
    throw new Error(`MSH version ${version} is not supported (only 2.2 and 4.1)`);
  }
  const v4 = v >= 4, binary = fileType === '1';
  r.setBinary(binary, +dataSize);
  if (binary) {
    // A binary 1 tells the byte order.
    if (r.view.getInt32(r.pos, true) === 1) r.le = true;
    else if (r.view.getInt32(r.pos, false) === 1) r.le = false;
    else throw new Error('Invalid binary .msh header');
    r.pos += 4;
  }
  r.skipPast('$EndMeshFormat');

  const physicalNames = new Map();  // `${dim}:${tag}` -> name
  let nodes = null, elements = null;
  while ((name = r.section()) !== null) {
    if (name === 'PhysicalNames') {
      for (let i = 0, n = parseInt(r.line()); i < n; i++) {
        const m = /^(\d+)\s+(-?\d+)\s+"(.*)"$/.exec(r.line());
        if (m) physicalNames.set(`${m[1]}:${m[2]}`, m[3]);
      }
    } else if (name === 'Nodes') {
      nodes = v4 ? readNodes4(r) : readNodes2(r);
    } else if (name === 'Elements') {
      if (!nodes) throw new Error('$Elements comes before $Nodes');
      elements = new Elements(nodes, physicalNames);
      if (v4) readElements4(r, elements); else readElements2(r, elements);
    }
    r.skipPast('$End' + name);
  }
  if (!elements) throw new Error('The file has no $Elements section');

  const all = [...elements.groups.values()];
  if (!all.length) throw new Error('The mesh has no surface or volume elements');
  const dim = Math.max(...all.map(g => g.dim));
  const groups = all.filter(g => g.dim === dim).map(g => surface(g, nodes, dim === 3));

  const counts = elements.counts;
  return {
    format: `MSH ${version} ${binary ? 'binary' : 'ASCII'}`,
    nodes: nodes.count,
    elements: Object.keys(SHAPE_NAMES).filter(s => counts[s]).map(s => [SHAPE_NAMES[s], counts[s]])
      .concat(counts.other ? [['Other elements', counts.other]] : []),
    groups,
  };
}

// --- Sections ---

function readNodes2(r) {
  const n = r.int();
  if (r.binary) r.skipLine();
  const tags = new Float64Array(n), xyz = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    tags[i] = r.I();
    xyz[3 * i] = r.D(); xyz[3 * i + 1] = r.D(); xyz[3 * i + 2] = r.D();
  }
  return nodeTable(tags, xyz);
}

function readNodes4(r) {
  const blocks = r.S(), n = r.S();
  r.S(); r.S();  // min / max node tag
  const tags = new Float64Array(n), xyz = new Float64Array(3 * n);
  let k = 0;
  for (let b = 0; b < blocks; b++) {
    const dim = r.I(); r.I(); const parametric = r.I(), count = r.S();
    if (k + count > n) throw new Error('Corrupt $Nodes section');
    for (let i = 0; i < count; i++) tags[k + i] = r.S();
    const extra = parametric ? dim : 0;  // u, v, w after x, y, z
    for (let i = k; i < k + count; i++) {
      xyz[3 * i] = r.D(); xyz[3 * i + 1] = r.D(); xyz[3 * i + 2] = r.D();
      for (let e = 0; e < extra; e++) r.D();
    }
    k += count;
  }
  return nodeTable(tags, xyz);
}

// Node coordinates plus a node tag -> index lookup (tags may be sparse).
function nodeTable(tags, xyz) {
  const count = tags.length;
  let max = 0;
  for (let i = 0; i < count; i++) if (tags[i] > max) max = tags[i];
  let index;
  if (max <= 4 * count + 1024) {
    const table = new Int32Array(max + 1).fill(-1);
    for (let i = 0; i < count; i++) if (tags[i] >= 0) table[tags[i]] = i;
    index = tag => (tag >= 0 && tag <= max ? table[tag] : -1);
  } else {
    const map = new Map();
    for (let i = 0; i < count; i++) map.set(tags[i], i);
    index = tag => map.get(tag) ?? -1;
  }
  return { count, xyz, index };
}

function readElements2(r, out) {
  const n = r.int();
  const tags = new Float64Array(MAX_NODES);
  if (!r.binary) {
    for (let i = 0; i < n; i++) {
      r.int();  // element tag
      const type = r.int(), ntags = r.int();
      const physical = ntags > 0 ? r.int() : 0, entity = ntags > 1 ? r.int() : 0;
      for (let t = 2; t < ntags; t++) r.int();
      const nn = TYPES[type]?.[1];
      if (nn === undefined) { out.counts.other = (out.counts.other || 0) + 1; r.skipLine(); continue; }
      for (let k = 0; k < nn; k++) tags[k] = r.int();
      out.add(type, physical, entity, tags);
    }
    return;
  }
  r.skipLine();
  // Binary: blocks of elements of one type, each a header then all-int32 records.
  for (let done = 0; done < n;) {
    const type = r.i32(), count = r.i32(), ntags = r.i32();
    const nn = TYPES[type]?.[1];
    if (nn === undefined) throw new Error(`Unsupported element type ${type}`);
    for (let e = 0; e < count; e++) {
      r.i32();  // element tag
      const physical = ntags > 0 ? r.i32() : 0, entity = ntags > 1 ? r.i32() : 0;
      for (let t = 2; t < ntags; t++) r.i32();
      for (let k = 0; k < nn; k++) tags[k] = r.i32();
      out.add(type, physical, entity, tags);
    }
    done += count;
  }
}

function readElements4(r, out) {
  const blocks = r.S();
  r.S(); r.S(); r.S();  // number of elements, min / max element tag
  const tags = new Float64Array(MAX_NODES);
  for (let b = 0; b < blocks; b++) {
    r.I(); const entity = r.I(), type = r.I(), count = r.S();
    const nn = TYPES[type]?.[1];
    if (nn === undefined) {
      if (r.binary) throw new Error(`Unsupported element type ${type}`);
      out.counts.other = (out.counts.other || 0) + count;
      for (let e = 0; e <= count; e++) r.skipLine();  // rest of the header line, then the elements
      continue;
    }
    for (let e = 0; e < count; e++) {
      r.S();  // element tag
      for (let k = 0; k < nn; k++) tags[k] = r.S();
      out.add(type, 0, entity, tags);
    }
  }
}

// Collects the faces of the elements, per group.
class Elements {
  constructor(nodes, physicalNames) {
    this.nodes = nodes;
    this.physicalNames = physicalNames;
    this.groups = new Map();
    this.counts = {};
    this.corners = new Int32Array(8);
  }

  add(type, physical, entity, tags) {
    const shape = TYPES[type][0];
    this.counts[shape] = (this.counts[shape] || 0) + 1;
    const faces = FACES[shape];
    if (!faces) return;  // lines, points

    const dim = DIM[shape];
    const id = physical || -entity;
    const key = 4 * id + dim;
    let g = this.groups.get(key);
    if (!g) {
      const name = physical ? this.physicalNames.get(`${dim}:${physical}`) ?? `Physical group ${physical}`
        : entity ? `${dim === 3 ? 'Volume' : 'Surface'} ${entity}` : '';
      g = { name, dim, elements: 0, faces: new IntList() };
      this.groups.set(key, g);
    }
    g.elements++;

    const c = this.corners;
    for (let k = 0; k < CORNERS[shape]; k++) {
      c[k] = this.nodes.index(tags[k]);
      if (c[k] < 0) throw new Error(`An element uses node ${tags[k]}, which is not in $Nodes`);
    }
    for (const f of faces) g.faces.push4(c[f[0]], c[f[1]], c[f[2]], f.length === 4 ? c[f[3]] : -1);
  }
}

// Growable Int32Array holding faces as 4 node indices each (-1 as 4th for a triangle).
class IntList {
  constructor() { this.data = new Int32Array(4096); this.length = 0; }
  push4(a, b, c, d) {
    if (this.length + 4 > this.data.length) {
      const grown = new Int32Array(this.data.length * 2);
      grown.set(this.data);
      this.data = grown;
    }
    const o = this.length;
    this.data[o] = a; this.data[o + 1] = b; this.data[o + 2] = c; this.data[o + 3] = d;
    this.length += 4;
  }
}

// --- Surface building ---

// Indices of the faces that occur exactly once (faces shared by two elements are inside).
function boundaryFaces(F, nf) {
  const key = new Int32Array(4 * nf);  // corner indices sorted ascending, -1 stays last
  for (let f = 0, o = 0; f < nf; f++, o += 4) {
    let a = F[o], b = F[o + 1], c = F[o + 2], d = F[o + 3], t;
    if (d < 0) {
      if (a > b) { t = a; a = b; b = t; }
      if (b > c) { t = b; b = c; c = t; }
      if (a > b) { t = a; a = b; b = t; }
    } else {
      if (a > b) { t = a; a = b; b = t; }
      if (c > d) { t = c; c = d; d = t; }
      if (a > c) { t = a; a = c; c = t; }
      if (b > d) { t = b; b = d; d = t; }
      if (b > c) { t = b; b = c; c = t; }
    }
    key[o] = a; key[o + 1] = b; key[o + 2] = c; key[o + 3] = d;
  }

  // Open-addressing hash set over the sorted keys; `hits` counts each key's first face.
  let size = 1024;
  while (size < 2 * nf) size *= 2;
  const mask = size - 1, slots = new Int32Array(size).fill(-1), hits = new Uint8Array(nf);
  for (let f = 0, o = 0; f < nf; f++, o += 4) {
    const a = key[o], b = key[o + 1], c = key[o + 2], d = key[o + 3];
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca6b) ^
      Math.imul(c + 0x165667b1, 0xc2b2ae35) ^ Math.imul(d + 1, 0x27d4eb2f);
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    for (h &= mask; ; h = (h + 1) & mask) {
      const s = slots[h];
      if (s < 0) { slots[h] = f; hits[f] = 1; break; }
      const q = 4 * s;
      if (key[q] === a && key[q + 1] === b && key[q + 2] === c && key[q + 3] === d) { hits[s] = 2; break; }
    }
  }

  let n = 0;
  for (let f = 0; f < nf; f++) if (hits[f] === 1) n++;
  const ids = new Int32Array(n);
  for (let f = 0, i = 0; f < nf; f++) if (hits[f] === 1) ids[i++] = f;
  return ids;
}

// Triangle mesh (quads split in two) with only the nodes it uses, plus its unique
// polygon edges as index pairs.
function surface(g, nodes, boundaryOnly) {
  const F = g.faces.data, nf = g.faces.length / 4;
  const ids = boundaryOnly ? boundaryFaces(F, nf) : Int32Array.from({ length: nf }, (_, i) => i);

  const remap = new Int32Array(nodes.count).fill(-1);
  let used = 0, tris = 0, sides = 0;
  for (const f of ids) {
    const n = F[4 * f + 3] < 0 ? 3 : 4;
    tris += n - 2;
    sides += n;
    for (let k = 0; k < n; k++) if (remap[F[4 * f + k]] < 0) remap[F[4 * f + k]] = used++;
  }

  const positions = new Float32Array(3 * used);
  for (let v = 0; v < nodes.count; v++) {
    const i = remap[v];
    if (i >= 0) positions.set(nodes.xyz.subarray(3 * v, 3 * v + 3), 3 * i);
  }

  const index = new Uint32Array(3 * tris), edgeKeys = new Float64Array(sides);
  let t = 0, e = 0;
  const edge = (p, q) => { edgeKeys[e++] = p < q ? p * used + q : q * used + p; };
  for (const f of ids) {
    const o = 4 * f, a = remap[F[o]], b = remap[F[o + 1]], c = remap[F[o + 2]];
    index[t++] = a; index[t++] = b; index[t++] = c;
    edge(a, b); edge(b, c);
    if (F[o + 3] < 0) { edge(c, a); continue; }
    const d = remap[F[o + 3]];
    index[t++] = a; index[t++] = c; index[t++] = d;
    edge(c, d); edge(d, a);
  }

  edgeKeys.sort();
  let unique = 0;
  for (let i = 0; i < sides; i++) if (i === 0 || edgeKeys[i] !== edgeKeys[i - 1]) edgeKeys[unique++] = edgeKeys[i];
  const edges = new Uint32Array(2 * unique);
  for (let i = 0; i < unique; i++) {
    const p = Math.floor(edgeKeys[i] / used);
    edges[2 * i] = p;
    edges[2 * i + 1] = edgeKeys[i] - p * used;
  }

  return { name: g.name, elements: g.elements, faces: ids.length, positions, index, edges };
}

// --- Byte reader for both ASCII and binary sections ---

const utf8 = new TextDecoder();

class Reader {
  constructor(buffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    this.pos = 0;
    this.le = true;
    this.setBinary(false, 8);
  }

  // I / S / D read an int / size_t / double in the file's encoding.
  setBinary(binary, sizeBytes) {
    this.binary = binary;
    this.sizeBytes = sizeBytes;
    this.I = binary ? this.i32 : this.int;
    this.S = binary ? this.size : this.int;
    this.D = binary ? this.f64 : this.float;
  }

  // Name of the next $Section, or null at the end of the file.
  section() {
    const b = this.bytes;
    let p = this.pos;
    while (p < b.length && b[p] <= 32) p++;
    if (p >= b.length) return null;
    if (b[p] !== 36) throw new Error(`Corrupt .msh file: expected a $Section at byte ${p}`);
    this.pos = p + 1;
    return this.line();
  }

  // The rest of the current line, trimmed.
  line() {
    const b = this.bytes, start = this.pos;
    let end = b.indexOf(10, start);
    if (end < 0) end = b.length;
    this.pos = end + 1;
    return utf8.decode(b.subarray(start, end)).trim();
  }

  skipLine() {
    const end = this.bytes.indexOf(10, this.pos);
    this.pos = end < 0 ? this.bytes.length : end + 1;
  }

  // Moves past the line holding `marker` (e.g. "$EndNodes").
  skipPast(marker) {
    const b = this.bytes, m = Array.from(marker, ch => ch.charCodeAt(0));
    for (let p = this.pos; (p = b.indexOf(m[0], p)) >= 0; p++) {
      let k = 1;
      while (k < m.length && b[p + k] === m[k]) k++;
      if (k === m.length) { this.pos = p + k; this.skipLine(); return; }
    }
    throw new Error(`Corrupt .msh file: missing ${marker}`);
  }

  // Start of the next whitespace-separated token.
  token() {
    const b = this.bytes;
    let p = this.pos;
    while (p < b.length && b[p] <= 32) p++;
    if (p >= b.length) throw new Error('Corrupt .msh file: unexpected end of file');
    return p;
  }

  // Finishes a number that spans [start, p): it must be followed by whitespace.
  finish(start, p, ok) {
    const b = this.bytes;
    if (!ok || (p < b.length && b[p] > 32)) {
      let end = start;
      while (end < b.length && b[end] > 32) end++;
      throw new Error(`Corrupt .msh file: "${utf8.decode(b.subarray(start, Math.min(end, start + 40)))}" is not a number`);
    }
    this.pos = p;
  }

  int() {
    const b = this.bytes, start = this.token();
    let p = start, v = 0, c;
    const neg = b[p] === 45;
    if (neg || b[p] === 43) p++;
    const digits = p;
    for (; p < b.length && (c = b[p] - 48) >= 0 && c <= 9; p++) v = v * 10 + c;
    this.finish(start, p, p > digits);
    return neg ? -v : v;
  }

  float() {
    const b = this.bytes, n = b.length, start = this.token();
    let p = start, v = 0, exp = 0, digits = 0, c;
    const neg = b[p] === 45;
    if (neg || b[p] === 43) p++;
    for (; p < n && (c = b[p] - 48) >= 0 && c <= 9; p++, digits++) v = v * 10 + c;
    if (b[p] === 46) for (p++; p < n && (c = b[p] - 48) >= 0 && c <= 9; p++, digits++, exp--) v = v * 10 + c;
    let ok = digits > 0;
    if (ok && (b[p] === 101 || b[p] === 69)) {  // e / E
      p++;
      const eneg = b[p] === 45;
      if (eneg || b[p] === 43) p++;
      let e = 0;
      const d0 = p;
      for (; p < n && (c = b[p] - 48) >= 0 && c <= 9; p++) e = e * 10 + c;
      ok = p > d0;
      exp += eneg ? -e : e;
    }
    this.finish(start, p, ok);
    const x = exp >= 0 ? v * 10 ** exp : v / 10 ** -exp;
    return neg ? -x : x;
  }

  i32() { const v = this.view.getInt32(this.pos, this.le); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, this.le); this.pos += 8; return v; }
  size() {
    if (this.sizeBytes === 4) { const v = this.view.getUint32(this.pos, this.le); this.pos += 4; return v; }
    const lo = this.view.getUint32(this.pos + (this.le ? 0 : 4), this.le);
    const hi = this.view.getUint32(this.pos + (this.le ? 4 : 0), this.le);
    this.pos += 8;
    return hi * 4294967296 + lo;
  }
}
