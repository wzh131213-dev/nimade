import { useEffect, useRef } from 'react'
import type { PointerEvent as RPointerEvent, ReactNode, RefObject } from 'react'
import type { Engine } from './engine'

/** 摇杆:手指离起点超过该距离即视为推满(像素) */
const STICK_R = 42
/** 摇杆底盘直径(像素),需与 index.css 中 .tc-stick-base 一致 */
const BASE = 144
/** 手指拖出圆圈外多少像素进入疾跑 / 回落多少像素退出疾跑 */
const SPRINT_ON = 88
const SPRINT_OFF = 74
const DEAD = 0.12

/** 视角区:轻点破坏,长按放置 */
const HOLD_MS = 420
const MOVE_SLOP = 10

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* 部分浏览器(如 iOS Safari)不支持震动 */
  }
}

function PadButton({
  className,
  onDown,
  onUp,
  children,
}: {
  className: string
  onDown: () => void
  onUp: () => void
  children: ReactNode
}) {
  const end = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.dataset.pressed !== '1') return
    e.currentTarget.dataset.pressed = '0'
    onUp()
  }
  return (
    <div
      className={`tc-btn ${className}`}
      data-pressed="0"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        e.currentTarget.dataset.pressed = '1'
        onDown()
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {children}
    </div>
  )
}

export default function TouchControls({
  engineRef,
  flying,
  onPause,
}: {
  engineRef: RefObject<Engine | null>
  flying: boolean
  onPause: () => void
}) {
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const stick = useRef({ id: -1, ox: 0, oy: 0, sprint: false })
  const look = useRef({ id: -1, x: 0, y: 0, sx: 0, sy: 0, moved: false, fired: false, timer: 0 })

  // 组件卸载(暂停 / 回到标题)时清掉所有输入,避免角色一直走
  useEffect(() => {
    const lookState = look.current
    return () => {
      window.clearTimeout(lookState.timer)
      const eng = engineRef.current
      eng?.setTouchMove(0, 0, false)
      eng?.setTouchJump(false)
      eng?.setTouchDescend(false)
      eng?.setHold(null)
    }
  }, [engineRef])

  /* ------------------------------ 摇杆 ------------------------------ */

  const resetStick = () => {
    stick.current.id = -1
    stick.current.sprint = false
    const b = baseRef.current
    const k = knobRef.current
    if (b) {
      b.style.left = ''
      b.style.top = ''
      b.style.bottom = ''
      b.dataset.active = '0'
      b.dataset.sprint = '0'
    }
    if (k) k.style.transform = ''
    engineRef.current?.setTouchMove(0, 0, false)
  }

  const onStickDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (stick.current.id !== -1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = e.currentTarget.getBoundingClientRect()
    stick.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY, sprint: false }
    const b = baseRef.current
    if (b) {
      b.style.left = `${e.clientX - r.left - BASE / 2}px`
      b.style.top = `${e.clientY - r.top - BASE / 2}px`
      b.style.bottom = 'auto'
      b.dataset.active = '1'
    }
  }

  const onStickMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = stick.current
    if (e.pointerId !== s.id) return
    const dx = e.clientX - s.ox
    const dy = e.clientY - s.oy
    const dist = Math.hypot(dx, dy)
    const clamp = dist > STICK_R ? STICK_R / dist : 1
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`

    let x = 0
    let y = 0
    const mag = Math.min(1, dist / STICK_R)
    if (mag > DEAD) {
      const m = (mag - DEAD) / (1 - DEAD)
      x = (dx / dist) * m
      y = (-dy / dist) * m
    }
    if (!s.sprint && dist >= SPRINT_ON && y > 0.3) s.sprint = true
    else if (s.sprint && (dist < SPRINT_OFF || y <= 0)) s.sprint = false
    if (baseRef.current) baseRef.current.dataset.sprint = s.sprint ? '1' : '0'
    engineRef.current?.setTouchMove(x, y, s.sprint)
  }

  const onStickEnd = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== stick.current.id) return
    resetStick()
  }

  /* ----------------------- 视角区:滑动 / 轻点 / 长按 ----------------------- */

  const onLookDown = (e: RPointerEvent<HTMLDivElement>) => {
    const l = look.current
    if (l.id !== -1) return
    e.currentTarget.setPointerCapture(e.pointerId)
    l.id = e.pointerId
    l.x = l.sx = e.clientX
    l.y = l.sy = e.clientY
    l.moved = false
    l.fired = false
    window.clearTimeout(l.timer)
    l.timer = window.setTimeout(() => {
      if (l.id === -1 || l.moved) return
      l.fired = true
      engineRef.current?.actionOnce('place')
      buzz(14)
    }, HOLD_MS)
  }

  const onLookMove = (e: RPointerEvent<HTMLDivElement>) => {
    const l = look.current
    if (e.pointerId !== l.id) return
    if (!l.moved) {
      if (Math.hypot(e.clientX - l.sx, e.clientY - l.sy) < MOVE_SLOP) return
      l.moved = true
      window.clearTimeout(l.timer)
      // 以越过阈值的位置为起点,避免视角突然跳一下
      l.x = e.clientX
      l.y = e.clientY
      return
    }
    engineRef.current?.touchLook(e.clientX - l.x, e.clientY - l.y)
    l.x = e.clientX
    l.y = e.clientY
  }

  const onLookUp = (e: RPointerEvent<HTMLDivElement>) => {
    const l = look.current
    if (e.pointerId !== l.id) return
    window.clearTimeout(l.timer)
    if (e.type === 'pointerup' && !l.moved && !l.fired) {
      engineRef.current?.actionOnce('break')
      buzz(8)
    }
    l.id = -1
  }

  const onLookCancel = (e: RPointerEvent<HTMLDivElement>) => {
    const l = look.current
    if (e.pointerId !== l.id) return
    window.clearTimeout(l.timer)
    l.id = -1
  }

  return (
    <div className="tc-root pointer-events-none absolute inset-0" onContextMenu={(e) => e.preventDefault()}>
      {/* 左半屏:浮动摇杆 */}
      <div
        className="pointer-events-auto absolute top-0 bottom-0 left-0 z-[5] w-1/2 touch-none"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickEnd}
        onPointerCancel={onStickEnd}
      >
        <div ref={baseRef} className="tc-stick-base" data-active="0" data-sprint="0">
          <div className="tc-stick-arrow">»</div>
          <div ref={knobRef} className="tc-stick-knob" />
        </div>
      </div>

      {/* 右半屏:滑动转视角,轻点破坏,长按放置 */}
      <div
        className="pointer-events-auto absolute top-0 right-0 bottom-0 z-[5] w-1/2 touch-none"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookCancel}
      />

      {/* 按键 */}
      <div className="pointer-events-none absolute inset-0 z-[15]">
        <PadButton
          className="tc-jump"
          onDown={() => engineRef.current?.setTouchJump(true)}
          onUp={() => engineRef.current?.setTouchJump(false)}
        >
          跳跃
        </PadButton>
        <PadButton
          className="tc-break"
          onDown={() => engineRef.current?.setHold('break')}
          onUp={() => engineRef.current?.setHold(null)}
        >
          破坏
        </PadButton>
        <PadButton
          className="tc-place"
          onDown={() => engineRef.current?.setHold('place')}
          onUp={() => engineRef.current?.setHold(null)}
        >
          放置
        </PadButton>
        {flying && (
          <PadButton
            className="tc-down"
            onDown={() => engineRef.current?.setTouchDescend(true)}
            onUp={() => engineRef.current?.setTouchDescend(false)}
          >
            下降
          </PadButton>
        )}
        <PadButton className="tc-pause" onDown={onPause} onUp={() => {}}>
          II
        </PadButton>
      </div>
    </div>
  )
}
