import * as THREE from 'three'

export const SX = 160
export const SY = 64
export const SZ = 160
export const CS = 16
export const SEA = 22

export const AIR = 0
export const GRASS = 1
export const DIRT = 2
export const STONE = 3
export const SAND = 4
export const WATER = 5
export const LOG = 6
export const LEAVES = 7
export const PLANKS = 8
export const COBBLE = 9
export const GLASS = 10

export const HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, SAND, GLASS, LEAVES]

const TILE = 16
const TILE_COUNT = 16

// [top, bottom, side]
const BLOCK_TILES: Record<number, [number, number, number]> = {
  [GRASS]: [0, 2, 1],
  [DIRT]: [2, 2, 2],
  [STONE]: [3, 3, 3],
  [SAND]: [4, 4, 4],
  [WATER]: [5, 5, 5],
  [LOG]: [7, 7, 6],
  [LEAVES]: [8, 8, 8],
  [PLANKS]: [9, 9, 9],
  [COBBLE]: [10, 10, 10],
  [GLASS]: [11, 11, 11],
}

// blocks that hide neighbouring faces
const OCC = new Uint8Array(16)
;[GRASS, DIRT, STONE, SAND, LOG, PLANKS, COBBLE].forEach((b) => (OCC[b] = 1))

export function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(ix: number, iz: number, seed: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function valueNoise(x: number, z: number, seed: number, period = 0) {
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const fx = x - x0
  const fz = z - z0
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const w = (v: number) => (period ? ((v % period) + period) % period : v)
  const a = hash2(w(x0), w(z0), seed)
  const b = hash2(w(x0 + 1), w(z0), seed)
  const c = hash2(w(x0), w(z0 + 1), seed)
  const d = hash2(w(x0 + 1), w(z0 + 1), seed)
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz
}

function fbm(x: number, z: number, seed: number, oct = 4) {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 101) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

/* ------------------------------------------------------------------ */
/* Procedural texture atlas                                            */
/* ------------------------------------------------------------------ */

let atlasCanvas: HTMLCanvasElement | null = null

export function getAtlas() {
  if (atlasCanvas) return atlasCanvas
  const c = document.createElement('canvas')
  c.width = TILE * TILE_COUNT
  c.height = TILE
  const ctx = c.getContext('2d')!
  const rnd = mulberry32(1234)
  const v = (amt: number) => (rnd() - 0.5) * 2 * amt

  const put = (tile: number, fn: (x: number, y: number) => [number, number, number, number]) => {
    const img = ctx.createImageData(TILE, TILE)
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b, a] = fn(x, y)
        const i = (y * TILE + x) * 4
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = a
      }
    }
    ctx.putImageData(img, tile * TILE, 0)
  }

  const grassPx = (): [number, number, number, number] => {
    const d = v(16)
    return [92 + d * 0.6, 158 + d, 50 + d * 0.4, 255]
  }
  const dirtPx = (): [number, number, number, number] => {
    const r = rnd()
    let d = v(8)
    if (r < 0.14) d -= 22
    else if (r > 0.9) d += 16
    return [134 + d, 96 + d * 0.8, 67 + d * 0.6, 255]
  }

  // 0 grass top
  put(0, grassPx)
  // 1 grass side
  const depth = Array.from({ length: TILE }, () => 2 + Math.floor(rnd() * 3))
  put(1, (x, y) => (y < depth[x] ? grassPx() : dirtPx()))
  // 2 dirt
  put(2, dirtPx)
  // 3 stone
  put(3, () => {
    let d = v(9)
    if (rnd() < 0.1) d -= 22
    return [125 + d, 125 + d, 127 + d, 255]
  })
  // 4 sand
  put(4, () => {
    const d = v(7)
    return [219 + d, 207 + d, 163 + d, 255]
  })
  // 5 water
  put(5, () => {
    const d = v(10)
    return [38 + d * 0.5, 92 + d, 214 + d, 255]
  })
  // 6 log side
  const stripe = Array.from({ length: TILE }, () => v(16))
  put(6, (x) => {
    let s = stripe[x]
    if (rnd() < 0.06) s -= 20
    return [104 + s + v(5), 83 + s + v(4), 52 + s + v(3), 255]
  })
  // 7 log top
  put(7, (x, y) => {
    const dist = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5))
    if (dist > 7) return [100 + v(5), 80 + v(4), 50 + v(3), 255]
    const ring = Math.floor(dist) % 2
    return ring ? [160 + v(5), 127 + v(4), 74 + v(3), 255] : [196 + v(5), 160 + v(4), 98 + v(3), 255]
  })
  // 8 leaves
  put(8, () => {
    const r = rnd()
    if (r < 0.2) return [0, 0, 0, 0]
    let d = v(20)
    if (r > 0.8) d -= 28
    return [48 + d * 0.6, 122 + d, 36 + d * 0.5, 255]
  })
  // 9 planks
  const boardShade = [0, -10, 8, -5]
  const joint = Array.from({ length: 4 }, () => 2 + Math.floor(rnd() * 12))
  put(9, (x, y) => {
    const board = Math.floor(y / 4)
    if (y % 4 === 3) return [112, 86, 48, 255]
    if (x === joint[board]) return [128, 100, 58, 255]
    const d = boardShade[board] + v(5)
    return [170 + d, 136 + d, 84 + d, 255]
  })
  // 10 cobblestone
  const ids: number[] = new Array(TILE * TILE).fill(0)
  let id = 1
  for (let y = 0; y < TILE; ) {
    const h = 3 + Math.floor(rnd() * 3)
    let x = -Math.floor(rnd() * 3)
    while (x < TILE) {
      const w = 4 + Math.floor(rnd() * 3)
      for (let yy = y; yy < Math.min(TILE, y + h); yy++)
        for (let xx = Math.max(0, x); xx < Math.min(TILE, x + w); xx++) ids[yy * TILE + xx] = id
      id++
      x += w
    }
    y += h
  }
  const cellShade = Array.from({ length: id + 1 }, () => 100 + rnd() * 50)
  put(10, (x, y) => {
    const me = ids[y * TILE + x]
    const right = x + 1 < TILE ? ids[y * TILE + x + 1] : -1
    const below = y + 1 < TILE ? ids[(y + 1) * TILE + x] : -1
    let s = cellShade[me] + v(6)
    if (right !== me || below !== me) s *= 0.62
    return [s, s, s + 2, 255]
  })
  // 11 glass
  put(11, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [205, 232, 238, 255]
    if ((x === 3 && y === 3) || (x === 4 && y === 4) || (x === 3 && y === 5) || (x === 5 && y === 3))
      return [240, 250, 252, 255]
    return [0, 0, 0, 0]
  })

  atlasCanvas = c
  return c
}

let atlasTex: THREE.CanvasTexture | null = null
export function getAtlasTexture() {
  if (atlasTex) return atlasTex
  const t = new THREE.CanvasTexture(getAtlas())
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  atlasTex = t
  return t
}

const iconCache = new Map<number, string>()
export function blockIcon(b: number) {
  const hit = iconCache.get(b)
  if (hit) return hit
  const atlas = getAtlas()
  const c = document.createElement('canvas')
  c.width = 48
  c.height = 48
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const [top, , side] = BLOCK_TILES[b]
  const draw = (tile: number, m: [number, number, number, number, number, number], shade: number) => {
    ctx.save()
    ctx.setTransform(...m)
    ctx.drawImage(atlas, tile * TILE, 0, TILE, TILE, 0, 0, TILE, TILE)
    if (shade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`
      ctx.fillRect(0, 0, TILE, TILE)
    }
    ctx.restore()
  }
  draw(top, [1.25, 0.625, -1.25, 0.625, 24, 4], 0)
  draw(side, [1.25, 0.625, 0, 1.25, 4, 14], 0.28)
  draw(side, [1.25, -0.625, 0, 1.25, 24, 24], 0.5)
  const url = c.toDataURL()
  iconCache.set(b, url)
  return url
}

let dirtUrl = ''
export function dirtDataURL() {
  if (dirtUrl) return dirtUrl
  const atlas = getAtlas()
  const c = document.createElement('canvas')
  c.width = TILE
  c.height = TILE
  c.getContext('2d')!.drawImage(atlas, 2 * TILE, 0, TILE, TILE, 0, 0, TILE, TILE)
  dirtUrl = c.toDataURL()
  return dirtUrl
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.7, ti: 2 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.7, ti: 2 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1, ti: 0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, ti: 1 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.85, ti: 2 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.85, ti: 2 },
]

const AO_B = [0.5, 0.68, 0.84, 1]

class MeshData {
  pos: number[] = []
  uv: number[] = []
  col: number[] = []
  idx: number[] = []
  toGeometry() {
    if (this.idx.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1))
    g.computeBoundingSphere()
    return g
  }
}

export class World {
  data = new Uint8Array(SX * SY * SZ)
  heights = new Int16Array(SX * SZ)
  panorama = { x: SX / 2, y: 40, z: SZ / 2 }

  constructor(seed = 7) {
    this.generate(seed)
    this.panorama = this.findPanoramaSpot()
  }

  get(x: number, y: number, z: number) {
    if (y < 0) return STONE
    if (y >= SY || x < 0 || x >= SX || z < 0 || z >= SZ) return AIR
    return this.data[(y * SZ + z) * SX + x]
  }

  set(x: number, y: number, z: number, b: number) {
    if (y < 0 || y >= SY || x < 0 || x >= SX || z < 0 || z >= SZ) return
    this.data[(y * SZ + z) * SX + x] = b
  }

  isSolid(x: number, y: number, z: number) {
    if (y < 0) return true
    if (x < 0 || x >= SX || z < 0 || z >= SZ) return true
    if (y >= SY) return false
    const b = this.data[(y * SZ + z) * SX + x]
    return b !== AIR && b !== WATER
  }

  private generate(seed: number) {
    const rnd = mulberry32(seed * 99)
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const n = fbm(x / 46, z / 46, seed)
        const m = (n - 0.5) * 2
        let h = 25 + m * 15 + Math.max(0, m - 0.12) * 42
        h += (fbm(x / 7, z / 7, seed + 50, 2) - 0.5) * 3.5
        h = Math.max(3, Math.min(SY - 10, Math.floor(h)))
        this.heights[z * SX + x] = h
        const sandy = h <= SEA + 1
        const rocky = h >= 43
        for (let y = 0; y <= h; y++) {
          let b = STONE
          if (y === h) b = sandy ? SAND : rocky ? STONE : GRASS
          else if (y >= h - 3 && !rocky) b = sandy ? SAND : DIRT
          this.data[(y * SZ + z) * SX + x] = b
        }
        for (let y = h + 1; y <= SEA; y++) this.data[(y * SZ + z) * SX + x] = WATER
      }
    }
    // trees
    for (let z = 4; z < SZ - 4; z++) {
      for (let x = 4; x < SX - 4; x++) {
        const h = this.heights[z * SX + x]
        if (this.get(x, h, z) !== GRASS) continue
        if (hash2(x, z, seed + 9) > 0.011) continue
        const th = 4 + Math.floor(rnd() * 2)
        for (let y = 1; y <= th; y++) this.set(x, h + y, z, LOG)
        const top = h + th
        for (let dy = -2; dy <= 1; dy++) {
          const r = dy <= -1 ? 2 : 1
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) === r && Math.abs(dz) === r && (dy >= 0 || rnd() < 0.45)) continue
              if (this.get(x + dx, top + dy, z + dz) === AIR) this.set(x + dx, top + dy, z + dz, LEAVES)
            }
          }
        }
      }
    }
  }

  private findPanoramaSpot() {
    let best = { x: SX / 2, y: 40, z: SZ / 2 }
    let bestScore = -Infinity
    const hAt = (x: number, z: number) =>
      Math.max(SEA, this.heights[Math.max(0, Math.min(SZ - 1, Math.floor(z))) * SX + Math.max(0, Math.min(SX - 1, Math.floor(x)))])
    for (let z = 66; z <= SZ - 66; z += 6) {
      for (let x = 66; x <= SX - 66; x += 6) {
        const ch = this.heights[z * SX + x]
        if (ch < SEA + 1 || ch > SEA + 9) continue
        const samples: number[] = []
        let blocked = 0
        let water = 0
        for (const r of [10, 22, 38]) {
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2
            const sx = x + Math.cos(a) * r
            const sz = z + Math.sin(a) * r
            const hh = hAt(sx, sz)
            samples.push(hh)
            if (r === 10 && hh > ch + 9) blocked++
            if (this.heights[Math.floor(sz) * SX + Math.floor(sx)] < SEA) water++
          }
        }
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length
        const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length)
        const waterFrac = water / samples.length
        const score = sd * 1.5 + Math.min(waterFrac, 0.35) * 25 - blocked * 8
        if (score > bestScore) {
          bestScore = score
          best = { x: x + 0.5, y: Math.max(ch, SEA) + 6, z: z + 0.5 }
        }
      }
    }
    return best
  }

  findSpawn() {
    const cx = SX / 2
    const cz = SZ / 2
    for (let r = 0; r < 60; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
          const x = cx + dx
          const z = cz + dz
          for (let y = SY - 1; y >= 0; y--) {
            const b = this.get(x, y, z)
            if (b === AIR) continue
            if (b === GRASS) return { x: x + 0.5, y: y + 1, z: z + 0.5 }
            break
          }
        }
      }
    }
    return { x: cx, y: SY - 1, z: cz }
  }

  private occAt(x: number, y: number, z: number) {
    return OCC[this.get(x, y, z)]
  }

  private ao(px: number, py: number, pz: number, a1: number, a2: number, s1: number, s2: number) {
    const d1 = [0, 0, 0]
    const d2 = [0, 0, 0]
    d1[a1] = s1
    d2[a2] = s2
    const e1 = this.occAt(px + d1[0], py + d1[1], pz + d1[2])
    const e2 = this.occAt(px + d2[0], py + d2[1], pz + d2[2])
    const cn = this.occAt(px + d1[0] + d2[0], py + d1[1] + d2[1], pz + d1[2] + d2[2])
    return e1 && e2 ? 0 : 3 - (e1 + e2 + cn)
  }

  buildChunk(cx: number, cz: number) {
    const o = new MeshData()
    const w = new MeshData()
    const x0 = cx * CS
    const z0 = cz * CS
    const aoV = [3, 3, 3, 3]

    for (let y = 0; y < SY; y++) {
      for (let z = z0; z < z0 + CS; z++) {
        for (let x = x0; x < x0 + CS; x++) {
          const b = this.data[(y * SZ + z) * SX + x]
          if (!b) continue
          const isWater = b === WATER
          const md = isWater ? w : o
          const tiles = BLOCK_TILES[b]
          for (const f of FACES) {
            const nb = this.get(x + f.n[0], y + f.n[1], z + f.n[2])
            if (isWater) {
              if (nb !== AIR) continue
            } else if (b === GLASS) {
              if (nb === GLASS || OCC[nb]) continue
            } else if (OCC[nb]) continue

            const tile = tiles[f.ti]
            const u0 = tile / TILE_COUNT
            const u1 = (tile + 1) / TILE_COUNT
            const base = md.pos.length / 3
            const ax = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2
            const a1 = (ax + 1) % 3
            const a2 = (ax + 2) % 3
            const useAO = !isWater && b !== GLASS
            const topH = isWater && this.get(x, y + 1, z) !== WATER ? 0.9 : 1
            for (let i = 0; i < 4; i++) {
              const c = f.c[i]
              md.pos.push(x + c[0], y + (c[1] ? topH : 0), z + c[2])
              md.uv.push(i === 1 || i === 2 ? u1 : u0, i >= 2 ? 1 : 0)
              let br = f.shade
              if (useAO) {
                const a = this.ao(x + f.n[0], y + f.n[1], z + f.n[2], a1, a2, c[a1] * 2 - 1, c[a2] * 2 - 1)
                aoV[i] = a
                br *= AO_B[a]
              }
              md.col.push(br, br, br)
            }
            if (useAO && aoV[0] + aoV[2] < aoV[1] + aoV[3]) {
              md.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base)
            } else {
              md.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
            }
          }
        }
      }
    }
    return { opaque: o.toGeometry(), water: w.toGeometry() }
  }
}

let world: World | null = null
export function getWorld() {
  if (!world) world = new World()
  return world
}
