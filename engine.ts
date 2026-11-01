import * as THREE from 'three'
import {
  AIR,
  CS,
  HOTBAR,
  SX,
  SY,
  SZ,
  WATER,
  World,
  getAtlasTexture,
  getWorld,
  valueNoise,
} from './world'

export interface Settings {
  fov: number
  sens: number
  chunks: number
}

export interface InfoPayload {
  text: string
  underwater: boolean
  fly: boolean
}

type ChunkMesh = { opaque?: THREE.Mesh; water?: THREE.Mesh }

const FOG_COLOR = 0xc0d8ff
const PLAYER_W = 0.6
const PLAYER_H = 1.8
const EYE = 1.62

export class Engine {
  mode: 'panorama' | 'game' = 'panorama'
  active = false
  noLock = false
  /** 触控模式:最近一次输入来自手指/手写笔(或主指针为粗指针设备) */
  touchMode = false
  settings: Settings = { fov: 70, sens: 1, chunks: 8 }
  slot = 0

  onLockChange?: (locked: boolean) => void
  onSlot?: (i: number) => void
  onInfo?: (i: InfoPayload) => void
  onTouchMode?: (touch: boolean) => void

  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private world: World
  private chunks = new Map<number, ChunkMesh>()
  private opaqueMat: THREE.MeshBasicMaterial
  private waterMat: THREE.MeshBasicMaterial
  private sky: THREE.Mesh
  private sun: THREE.Group
  private clouds: THREE.Mesh
  private cloudTex: THREE.CanvasTexture
  private outline: THREE.LineSegments
  private fog: THREE.Fog

  private raf = 0
  private last = 0
  private time = 0
  private infoTimer = 0
  private disposed = false

  private pos = new THREE.Vector3()
  private vel = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private onGround = false
  private fly = false
  private lastSpace = 0
  private fovBoost = 0
  private keys = new Set<string>()
  private spawned = false
  private underwater = false

  // 触控输入状态
  private touchMove = { x: 0, y: 0 }
  private touchSprint = false
  private touchJump = false
  private touchDown = false
  private hold: 'break' | 'place' | null = null
  private holdTimer = 0
  private lastTouchTime = 0

  private panoYaw = 0.6

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.world = getWorld()

    this.touchMode = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.touchMode })
    // 手机屏幕像素密度很高,限制渲染分辨率以保证帧率
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.touchMode ? 1.5 : 2))
    this.camera = new THREE.PerspectiveCamera(85, 1, 0.05, 1500)
    this.camera.rotation.order = 'YXZ'

    this.fog = new THREE.Fog(FOG_COLOR, 20, 64)
    this.scene.fog = this.fog
    this.scene.background = new THREE.Color(FOG_COLOR)

    const tex = getAtlasTexture()
    this.opaqueMat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 })
    this.waterMat = new THREE.MeshBasicMaterial({
      map: tex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    // sky dome
    const skyGeo = new THREE.SphereGeometry(600, 24, 16)
    const top = new THREE.Color(0x5f97ec)
    const hor = new THREE.Color(FOG_COLOR)
    const cols: number[] = []
    const p = skyGeo.attributes.position
    const tmp = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, p.getY(i) / 600))
      tmp.copy(hor).lerp(top, Math.pow(t, 0.55))
      cols.push(tmp.r, tmp.g, tmp.b)
    }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
    this.sky = new THREE.Mesh(
      skyGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
    )
    this.sky.renderOrder = -3
    this.scene.add(this.sky)

    // sun
    this.sun = new THREE.Group()
    const sunCore = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({ color: 0xfff6c8, fog: false, depthWrite: false }),
    )
    const sunHalo = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false, transparent: true, opacity: 0.22 }),
    )
    sunCore.renderOrder = -1
    sunHalo.renderOrder = -2
    sunCore.position.z = 0.1
    this.sun.add(sunHalo, sunCore)
    this.scene.add(this.sun)

    // clouds
    const cc = document.createElement('canvas')
    cc.width = 64
    cc.height = 64
    const cctx = cc.getContext('2d')!
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const n = 0.65 * valueNoise(x / 8, y / 8, 77, 8) + 0.35 * valueNoise(x / 4, y / 4, 78, 16)
        if (n > 0.56) {
          cctx.fillStyle = 'rgba(255,255,255,0.88)'
          cctx.fillRect(x, y, 1, 1)
        }
      }
    }
    this.cloudTex = new THREE.CanvasTexture(cc)
    this.cloudTex.magFilter = THREE.NearestFilter
    this.cloudTex.minFilter = THREE.NearestFilter
    this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping
    this.cloudTex.colorSpace = THREE.SRGBColorSpace
    const R = 2400 / 768
    this.cloudTex.repeat.set(R, R)
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshBasicMaterial({
        map: this.cloudTex,
        transparent: true,
        fog: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.clouds.rotation.x = -Math.PI / 2
    this.clouds.renderOrder = 2
    this.scene.add(this.clouds)

    // block selection outline
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000 }),
    )
    this.outline.visible = false
    this.scene.add(this.outline)

    // chunks
    for (let cz = 0; cz < SZ / CS; cz++) for (let cx = 0; cx < SX / CS; cx++) this.rebuildChunk(cx, cz)

    this.applyFog()
    this.resize()

    window.addEventListener('resize', this.resize)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('pointerdown', this.onAnyPointer, true)
    window.addEventListener('pointerup', this.onAnyPointer, true)
    document.addEventListener('pointerlockchange', this.onPLChange)
    document.addEventListener('pointerlockerror', this.onPLError)
    document.addEventListener('mousemove', this.onMouseMove)
    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('contextmenu', this.prevent)
    canvas.addEventListener('wheel', this.onWheel, { passive: true })

    this.raf = requestAnimationFrame(this.loop)
  }

  /* ---------------------------- public API --------------------------- */

  setSettings(s: Settings) {
    this.settings = s
    this.applyFog()
  }

  setActive(a: boolean) {
    this.active = a
    if (!a) {
      this.keys.clear()
      this.resetTouchInput()
    }
  }

  setMode(m: 'panorama' | 'game') {
    this.mode = m
    if (m === 'game' && !this.spawned) {
      const s = this.world.findSpawn()
      this.pos.set(s.x, s.y, s.z)
      this.vel.set(0, 0, 0)
      this.yaw = 0.6
      this.pitch = 0
      this.spawned = true
    }
    if (m === 'panorama') this.outline.visible = false
    this.applyFog()
    this.camera.fov = m === 'panorama' ? 85 : this.settings.fov
    this.camera.updateProjectionMatrix()
  }

  isLocked() {
    return document.pointerLockElement === this.canvas
  }

  lock() {
    if (this.touchMode) {
      // 触屏设备没有指针锁定,视角由屏幕滑动控制
      this.noLock = true
      return
    }
    this.noLock = false
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined
      if (r && typeof r.catch === 'function') r.catch(() => (this.noLock = true))
    } catch {
      this.noLock = true
    }
  }

  unlock() {
    if (this.isLocked()) document.exitPointerLock()
  }

  selectSlot(i: number) {
    this.slot = (i + 9) % 9
    this.onSlot?.(this.slot)
  }

  /* ----------------------------- touch API ---------------------------- */

  /** 摇杆输出:x 向右为正,y 向前为正,范围 [-1,1] */
  setTouchMove(x: number, y: number, sprint: boolean) {
    this.touchMove.x = x
    this.touchMove.y = y
    this.touchSprint = sprint
  }

  /** 屏幕滑动转视角(单位:像素) */
  touchLook(dx: number, dy: number) {
    if (this.mode !== 'game' || !this.active) return
    const k = 0.0045 * this.settings.sens
    this.yaw -= dx * k
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - dy * k))
  }

  setTouchJump(down: boolean) {
    if (down && !this.touchJump && this.mode === 'game' && this.active) this.pressJump()
    this.touchJump = down
  }

  setTouchDescend(down: boolean) {
    this.touchDown = down
  }

  /** 单次破坏 / 放置(轻点、长按) */
  actionOnce(kind: 'break' | 'place') {
    if (this.mode !== 'game' || !this.active) return
    this.act(kind)
  }

  /** 按住连续破坏 / 放置;传 null 松开 */
  setHold(kind: 'break' | 'place' | null) {
    this.hold = kind
    if (kind && this.mode === 'game' && this.active) {
      this.act(kind)
      this.holdTimer = 0.35
    }
  }

  private resetTouchInput() {
    this.touchMove.x = 0
    this.touchMove.y = 0
    this.touchSprint = false
    this.touchJump = false
    this.touchDown = false
    this.hold = null
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('pointerdown', this.onAnyPointer, true)
    window.removeEventListener('pointerup', this.onAnyPointer, true)
    document.removeEventListener('pointerlockchange', this.onPLChange)
    document.removeEventListener('pointerlockerror', this.onPLError)
    document.removeEventListener('mousemove', this.onMouseMove)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('contextmenu', this.prevent)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.chunks.forEach((c) => {
      c.opaque?.geometry.dispose()
      c.water?.geometry.dispose()
    })
    this.renderer.dispose()
  }

  /* ----------------------------- internals --------------------------- */

  private prevent = (e: Event) => e.preventDefault()

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private applyFog() {
    if (this.mode === 'panorama') {
      this.fog.near = 18
      this.fog.far = 64
    } else if (this.underwater) {
      this.fog.near = 0.5
      this.fog.far = 22
    } else {
      const far = this.settings.chunks * CS
      this.fog.far = far
      this.fog.near = far * 0.5
    }
    const col = this.underwater && this.mode === 'game' ? 0x1a3e9c : FOG_COLOR
    this.fog.color.set(col)
    ;(this.scene.background as THREE.Color).set(col)
  }

  private rebuildChunk(cx: number, cz: number) {
    if (cx < 0 || cz < 0 || cx >= SX / CS || cz >= SZ / CS) return
    const key = cz * 64 + cx
    const old = this.chunks.get(key)
    if (old) {
      if (old.opaque) {
        this.scene.remove(old.opaque)
        old.opaque.geometry.dispose()
      }
      if (old.water) {
        this.scene.remove(old.water)
        old.water.geometry.dispose()
      }
    }
    const { opaque, water } = this.world.buildChunk(cx, cz)
    const entry: ChunkMesh = {}
    if (opaque) {
      entry.opaque = new THREE.Mesh(opaque, this.opaqueMat)
      this.scene.add(entry.opaque)
    }
    if (water) {
      entry.water = new THREE.Mesh(water, this.waterMat)
      entry.water.renderOrder = 1
      this.scene.add(entry.water)
    }
    this.chunks.set(key, entry)
  }

  private rebuildAround(x: number, z: number) {
    const cx = Math.floor(x / CS)
    const cz = Math.floor(z / CS)
    const lx = x - cx * CS
    const lz = z - cz * CS
    const dxs = [0]
    const dzs = [0]
    if (lx === 0) dxs.push(-1)
    if (lx === CS - 1) dxs.push(1)
    if (lz === 0) dzs.push(-1)
    if (lz === CS - 1) dzs.push(1)
    for (const dx of dxs) for (const dz of dzs) this.rebuildChunk(cx + dx, cz + dz)
  }

  /* ------------------------------ input ------------------------------ */

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode !== 'game' || !this.active) return
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault()
    if (e.code === 'Space' && !e.repeat) this.pressJump()
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10)
      if (n >= 1 && n <= 9) this.selectSlot(n - 1)
    }
    this.keys.add(e.code)
  }

  /** 跳跃键按下:300ms 内连按两次切换飞行(键盘空格与触屏跳跃键共用) */
  private pressJump() {
    const now = performance.now()
    if (now - this.lastSpace < 300) {
      this.fly = !this.fly
      this.vel.y = 0
    }
    this.lastSpace = now
  }

  /** 记录输入设备类型:手指/笔 => 触控模式,鼠标 => 桌面模式 */
  private onAnyPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.lastTouchTime = performance.now()
      if (!this.touchMode) {
        this.touchMode = true
        this.onTouchMode?.(true)
      }
    } else if (e.type === 'pointerdown' && e.pointerType === 'mouse' && this.touchMode) {
      this.touchMode = false
      this.resetTouchInput()
      this.onTouchMode?.(false)
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onBlur = () => this.keys.clear()

  private onPLChange = () => {
    const l = this.isLocked()
    if (!l) this.keys.clear()
    this.onLockChange?.(l)
  }

  private onPLError = () => {
    this.noLock = true
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.mode !== 'game' || !this.active || !this.isLocked()) return
    const k = 0.0022 * this.settings.sens
    this.yaw -= e.movementX * k
    this.pitch -= e.movementY * k
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch))
  }

  private onWheel = (e: WheelEvent) => {
    if (this.mode !== 'game' || !this.active) return
    this.selectSlot(this.slot + (e.deltaY > 0 ? 1 : -1))
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.mode !== 'game' || !this.active) return
    // 触屏点按后浏览器会补发一次兼容的鼠标事件,忽略它避免误操作
    if (this.touchMode || performance.now() - this.lastTouchTime < 700) return
    if (!this.isLocked()) {
      const was = this.noLock
      this.lock()
      if (!was) return
    }
    if (e.button === 0) this.act('break')
    else if (e.button === 2) this.act('place')
  }

  /** 对准星指向的方块执行破坏 / 放置,成功返回 true */
  private act(kind: 'break' | 'place'): boolean {
    const hit = this.raycast(6)
    if (!hit) return false
    if (kind === 'break') {
      if (hit.y === 0) return false
      this.world.set(hit.x, hit.y, hit.z, AIR)
      this.rebuildAround(hit.x, hit.z)
      return true
    }
    const px = hit.x + hit.nx
    const py = hit.y + hit.ny
    const pz = hit.z + hit.nz
    if (py < 0 || py >= SY || px < 0 || px >= SX || pz < 0 || pz >= SZ) return false
    const cur = this.world.get(px, py, pz)
    if (cur !== AIR && cur !== WATER) return false
    // don't place inside the player
    const hw = PLAYER_W / 2
    if (
      px + 1 > this.pos.x - hw &&
      px < this.pos.x + hw &&
      pz + 1 > this.pos.z - hw &&
      pz < this.pos.z + hw &&
      py + 1 > this.pos.y &&
      py < this.pos.y + PLAYER_H
    )
      return false
    this.world.set(px, py, pz, HOTBAR[this.slot])
    this.rebuildAround(px, pz)
    return true
  }

  private raycast(maxD: number) {
    const o = new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z)
    const d = new THREE.Vector3()
    this.camera.getWorldDirection(d)
    let x = Math.floor(o.x)
    let y = Math.floor(o.y)
    let z = Math.floor(o.z)
    const sx = d.x > 0 ? 1 : -1
    const sy = d.y > 0 ? 1 : -1
    const sz = d.z > 0 ? 1 : -1
    const tdx = d.x !== 0 ? Math.abs(1 / d.x) : Infinity
    const tdy = d.y !== 0 ? Math.abs(1 / d.y) : Infinity
    const tdz = d.z !== 0 ? Math.abs(1 / d.z) : Infinity
    let tmx = d.x !== 0 ? (d.x > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity
    let tmy = d.y !== 0 ? (d.y > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity
    let tmz = d.z !== 0 ? (d.z > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity
    let t = 0
    let nx = 0
    let ny = 0
    let nz = 0
    while (t <= maxD) {
      const b = this.world.get(x, y, z)
      if (b !== AIR && b !== WATER) return { x, y, z, nx, ny, nz, b }
      if (tmx < tmy && tmx < tmz) {
        x += sx
        t = tmx
        tmx += tdx
        nx = -sx
        ny = 0
        nz = 0
      } else if (tmy < tmz) {
        y += sy
        t = tmy
        tmy += tdy
        nx = 0
        ny = -sy
        nz = 0
      } else {
        z += sz
        t = tmz
        tmz += tdz
        nx = 0
        ny = 0
        nz = -sz
      }
    }
    return null
  }

  /* ----------------------------- physics ----------------------------- */

  private collides(px: number, py: number, pz: number) {
    const hw = PLAYER_W / 2
    const x0 = Math.floor(px - hw)
    const x1 = Math.floor(px + hw)
    const y0 = Math.floor(py)
    const y1 = Math.floor(py + PLAYER_H - 0.001)
    const z0 = Math.floor(pz - hw)
    const z1 = Math.floor(pz + hw)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (this.world.isSolid(x, y, z)) return true
    return false
  }

  private updateGame(dt: number) {
    const k = this.keys
    const turn = 1.9 * dt
    if (k.has('ArrowLeft')) this.yaw += turn
    if (k.has('ArrowRight')) this.yaw -= turn
    if (k.has('ArrowUp')) this.pitch = Math.min(1.55, this.pitch + turn)
    if (k.has('ArrowDown')) this.pitch = Math.max(-1.55, this.pitch - turn)

    // 键盘 ±1 + 摇杆模拟量(-1~1)
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) + this.touchMove.y
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) + this.touchMove.x
    const sprint = (k.has('ShiftLeft') || k.has('ShiftRight') || this.touchSprint) && f > 0
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)
    let wx = -sin * f + cos * s
    let wz = -cos * f - sin * s
    const len = Math.hypot(wx, wz)
    // 超过 1 才归一化,摇杆轻推时保留模拟速度
    if (len > 1) {
      wx /= len
      wz /= len
    }

    const inWater = this.world.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z)) === WATER
    let speed = this.fly ? (sprint ? 20 : 11) : sprint ? 6 : 4.3
    if (inWater && !this.fly) speed *= 0.55
    const tx = wx * speed
    const tz = wz * speed
    const fh = 1 - Math.exp(-dt * (this.onGround || this.fly ? 14 : 3.5))
    this.vel.x += (tx - this.vel.x) * fh
    this.vel.z += (tz - this.vel.z) * fh

    const up = k.has('Space') || this.touchJump
    if (this.fly) {
      const down = k.has('KeyC') || k.has('ControlLeft') || this.touchDown
      const ty = ((up ? 1 : 0) - (down ? 1 : 0)) * 10
      this.vel.y += (ty - this.vel.y) * (1 - Math.exp(-dt * 10))
    } else if (inWater) {
      this.vel.y -= 9 * dt
      this.vel.y *= Math.exp(-dt * 2.5)
      if (up) this.vel.y = Math.min(this.vel.y + 24 * dt, 3.6)
    } else {
      this.vel.y -= 28 * dt
      if (this.vel.y < -50) this.vel.y = -50
      if (up && this.onGround) this.vel.y = 8.6
    }

    const steps = Math.max(1, Math.ceil(dt / 0.005))
    const h = dt / steps
    this.onGround = false
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * h
      if (this.collides(this.pos.x, this.pos.y, this.pos.z)) {
        this.pos.x -= this.vel.x * h
        this.vel.x = 0
      }
      this.pos.z += this.vel.z * h
      if (this.collides(this.pos.x, this.pos.y, this.pos.z)) {
        this.pos.z -= this.vel.z * h
        this.vel.z = 0
      }
      this.pos.y += this.vel.y * h
      if (this.collides(this.pos.x, this.pos.y, this.pos.z)) {
        this.pos.y -= this.vel.y * h
        if (this.vel.y < 0) {
          this.onGround = true
          if (this.fly) this.fly = false
        }
        this.vel.y = 0
      }
    }
    if (this.pos.y < -20) {
      const sp = this.world.findSpawn()
      this.pos.set(sp.x, sp.y, sp.z)
      this.vel.set(0, 0, 0)
    }

    const targetBoost = sprint && len > 0 ? 8 : 0
    this.fovBoost += (targetBoost - this.fovBoost) * (1 - Math.exp(-dt * 8))
    const fov = this.settings.fov + this.fovBoost
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }

    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z)
    this.camera.rotation.set(this.pitch, this.yaw, 0)

    // 按住破坏 / 放置按钮时连续触发
    if (this.hold) {
      this.holdTimer -= dt
      if (this.holdTimer <= 0) {
        this.act(this.hold)
        this.holdTimer = 0.2
      }
    }

    const uw =
      this.world.get(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z)) === WATER
    if (uw !== this.underwater) {
      this.underwater = uw
      this.applyFog()
    }

    // outline
    const hit = this.active ? this.raycast(6) : null
    if (hit) {
      this.outline.visible = true
      this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
    } else this.outline.visible = false

    this.infoTimer += dt
    if (this.infoTimer > 0.2) {
      this.infoTimer = 0
      this.onInfo?.({
        text: `XYZ: ${this.pos.x.toFixed(2)} / ${this.pos.y.toFixed(2)} / ${this.pos.z.toFixed(2)}${this.fly ? '  [飞行]' : ''}`,
        underwater: this.underwater,
        fly: this.fly,
      })
    }
  }

  private updatePanorama(dt: number) {
    this.panoYaw += dt * 0.055
    const p = this.world.panorama
    this.camera.position.set(p.x, p.y, p.z)
    this.camera.rotation.set(-0.17 + Math.sin(this.time * 0.12) * 0.035, this.panoYaw, 0)
  }

  private loop = (t: number) => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0.016)
    this.last = t
    this.time += dt

    if (this.mode === 'panorama') this.updatePanorama(dt)
    else if (this.active) this.updateGame(dt)
    else {
      this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z)
      this.camera.rotation.set(this.pitch, this.yaw, 0)
    }

    const cp = this.camera.position
    this.sky.position.copy(cp)
    this.sun.position.set(cp.x + 220, cp.y + 340, cp.z - 300)
    this.sun.lookAt(cp)
    this.clouds.position.set(cp.x, 74, cp.z)
    this.cloudTex.offset.set(cp.x / 768 + this.time * 0.0016, -cp.z / 768)
    this.renderer.render(this.scene, this.camera)
  }
}

