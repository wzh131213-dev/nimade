import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Engine } from './engine'
import type { InfoPayload, Settings } from './engine'
import Logo from './Logo'
import TouchControls from './TouchControls'
import { HOTBAR, blockIcon, dirtDataURL } from './world'

type Screen = 'title' | 'options' | 'multi' | 'loading' | 'playing' | 'paused' | 'quit'

const SPLASHES = [
  '你好,世界!',
  '苦力怕?哎呀老兄!',
  '别往下挖!',
  '100% 纯天然方块!',
  '现在运行在浏览器里!',
  '快看,是末影人!',
  '合成表在脑子里!',
  '小心岩浆!',
  '钻石!钻石!',
  '一方块一世界!',
  '天黑之前回家!',
  '也试试挖矿吧!',
  '像素风永不过时!',
]

const TIPS = 'WASD 移动 · 空格 跳跃(双击飞行) · Shift 疾跑 · 左键 破坏 · 右键 放置 · 1-9 / 滚轮 切换方块 · Esc 菜单'
const TIPS_TOUCH =
  '左侧拖动 移动(拖出圆圈外疾跑) · 右侧拖动 转视角 · 轻点 破坏 · 长按 放置 · 连点两下跳跃键 飞行 · 点快捷栏切换方块'

/** 尝试进入全屏并锁定横屏(Android Chrome 等支持;iOS Safari 会静默忽略) */
function enterFullscreen() {
  try {
    const el = document.documentElement
    if (document.fullscreenElement || !el.requestFullscreen) return
    Promise.resolve(el.requestFullscreen({ navigationUI: 'hide' }))
      .then(() => {
        const o = screen.orientation as unknown as { lock?: (o: string) => Promise<void> }
        return o.lock?.('landscape')
      })
      .catch(() => {})
  } catch {
    /* 忽略 */
  }
}

function McButton({
  children,
  onClick,
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button className={`mc-btn ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function McSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const pct = (value - min) / (max - min)
  return (
    <div className="mc-slider relative h-10 w-full">
      <div className="absolute inset-0 border-2 border-black bg-[#3a3a3a] shadow-[inset_2px_2px_0_rgba(0,0,0,0.5),inset_-2px_-2px_0_rgba(255,255,255,0.25)]" />
      <div
        className="mc-handle absolute top-0 bottom-0 w-[12px]"
        style={{ left: `calc(${pct} * (100% - 12px))` }}
      />
      <div className="mc-text pointer-events-none absolute inset-0 flex items-center justify-center text-[18px] font-semibold">
        {label}: {format(value)}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer touch-none opacity-0"
      />
    </div>
  )
}

function DirtScreen({ children, dim = 0.62 }: { children: ReactNode; dim?: number }) {
  const url = useMemo(() => dirtDataURL(), [])
  return (
    <div
      className="dirt-bg menu-scroll absolute inset-0 z-20 flex flex-col items-center"
      style={{
        backgroundImage: `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})), url(${url})`,
      }}
    >
      {children}
    </div>
  )
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [screen, setScreenState] = useState<Screen>('title')
  const screenRef = useRef<Screen>('title')
  const optionsFrom = useRef<Screen>('title')
  const [settings, setSettings] = useState<Settings>({ fov: 70, sens: 1, chunks: 8 })
  const [slot, setSlot] = useState(0)
  const [info, setInfo] = useState<InfoPayload>({ text: '', underwater: false, fly: false })
  const [touch, setTouch] = useState(false)
  const [progress, setProgress] = useState(0)
  const [splash] = useState(() => SPLASHES[Math.floor(Math.random() * SPLASHES.length)])

  const go = useCallback((s: Screen) => {
    screenRef.current = s
    setScreenState(s)
    engineRef.current?.setActive(s === 'playing')
  }, [])

  useEffect(() => {
    const engine = new Engine(canvasRef.current!)
    engineRef.current = engine
    engine.onSlot = setSlot
    engine.onInfo = setInfo
    engine.onTouchMode = setTouch
    setTouch(engine.touchMode)
    engine.onLockChange = (locked) => {
      if (!locked && screenRef.current === 'playing') go('paused')
    }
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [go])

  useEffect(() => {
    engineRef.current?.setSettings(settings)
  }, [settings])

  // iOS Safari 忽略 user-scalable=no,需要拦截捏合手势
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault()
    document.addEventListener('gesturestart', stop)
    document.addEventListener('gesturechange', stop)
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
    }
  }, [])

  // Esc handling when pointer lock isn't available
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return
      const s = screenRef.current
      const eng = engineRef.current
      if (s === 'playing') go('paused')
      else if (s === 'paused') {
        eng?.lock()
        go('playing')
      } else if (s === 'options') go(optionsFrom.current)
      else if (s === 'multi') go('title')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  // loading progress
  useEffect(() => {
    if (screen !== 'loading') return
    setProgress(0)
    const start = performance.now()
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - start) / 1700)
      setProgress(p)
      if (p >= 1) {
        clearInterval(id)
        const eng = engineRef.current!
        eng.setMode('game')
        if (eng.isLocked() || eng.noLock) go('playing')
        else go('paused')
      }
    }, 50)
    return () => clearInterval(id)
  }, [screen, go])

  const startGame = () => {
    engineRef.current?.lock()
    if (engineRef.current?.touchMode) enterFullscreen()
    go('loading')
  }

  const resume = () => {
    engineRef.current?.lock()
    go('playing')
  }

  const toTitle = () => {
    go('title')
    const eng = engineRef.current
    eng?.unlock()
    eng?.setMode('panorama')
  }

  const openOptions = (from: Screen) => {
    optionsFrom.current = from
    go('options')
  }

  const inGame = screen === 'playing' || screen === 'paused' || (screen === 'options' && optionsFrom.current === 'paused')

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* ------------------------------ TITLE ------------------------------ */}
      {screen === 'title' && (
        <div className="menu-scroll absolute inset-0 z-10 flex flex-col items-center">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/45" />
          <div className="relative mt-[5vh] flex flex-col items-center">
            <div className="relative">
              <Logo />
              <div
                className="splash pointer-events-none absolute right-[-2%] bottom-[-6%] whitespace-nowrap text-[clamp(16px,2.4vw,26px)] font-bold"
                style={{ color: '#ffff00', textShadow: '2px 2px 0 #3f3f00' }}
              >
                {splash}
              </div>
            </div>
            <div
              className="mc-text -mt-1 self-end pr-[4%] text-[clamp(12px,1.6vw,18px)] font-bold tracking-[0.3em] italic"
              style={{ color: '#e6e6e6' }}
            >
              WEB EDITION
            </div>
          </div>

          <div className="relative mt-[5vh] flex w-[min(400px,90vw)] flex-col gap-2">
            <McButton onClick={startGame}>单人游戏</McButton>
            <McButton onClick={() => go('multi')}>多人游戏</McButton>
            <McButton disabled>Minecraft Realms</McButton>
            <div className="mt-4 flex gap-2 [@media(max-height:440px)]:mt-0">
              <McButton onClick={() => openOptions('title')}>选项...</McButton>
              <McButton onClick={() => go('quit')}>退出游戏</McButton>
            </div>
          </div>

          <div className="mc-text safe-bl absolute text-[15px]">Minecraft 1.20.4</div>
          <div className="mc-text safe-br absolute text-[15px]">版权所有 Mojang AB,请勿散布!</div>
        </div>
      )}

      {/* ----------------------------- MULTIPLAYER ----------------------------- */}
      {screen === 'multi' && (
        <DirtScreen>
          <h2 className="mc-text mt-5 text-[22px] font-semibold">玩多人游戏</h2>
          <div className="mt-4 h-[50%] w-[min(620px,92vw)] overflow-hidden border-2 border-[#000] bg-black/60 shadow-[inset_0_0_0_2px_#2a2a2a]">
            <div className="flex items-center gap-3 border-2 border-transparent p-2 hover:border-[#9a9a9a]">
              <img src={blockIcon(1)} alt="" className="h-16 w-16" style={{ imageRendering: 'pixelated' }} />
              <div className="flex-1">
                <div className="mc-text text-[18px]">Minecraft 服务器</div>
                <div className="text-[16px] text-[#ff5555]" style={{ textShadow: '2px 2px 0 #3f1515' }}>
                  无法连接到服务器
                </div>
                <div className="text-[14px] text-[#a0a0a0]">localhost:25565</div>
              </div>
              <div className="mr-2 flex items-end gap-[2px]">
                {[8, 12, 16, 20, 24].map((h) => (
                  <div key={h} className="w-[5px] bg-[#4a4a4a]" style={{ height: h }} />
                ))}
              </div>
            </div>
            <div className="p-4 text-[15px] text-[#bbb]">网页演示版暂不支持联机,请尝试单人游戏。</div>
          </div>
          <div className="mt-4 flex w-[min(420px,92vw)] flex-col gap-2">
            <div className="flex gap-2">
              <McButton disabled>加入服务器</McButton>
              <McButton disabled>直接连接</McButton>
            </div>
            <McButton onClick={() => go('title')}>返回</McButton>
          </div>
        </DirtScreen>
      )}

      {/* ------------------------------ OPTIONS ------------------------------ */}
      {screen === 'options' &&
        (() => {
          const body = (
            <>
              <h2 className="mc-text mt-6 text-[22px] font-semibold [@media(max-height:440px)]:mt-3">选项</h2>
              <div className="mt-6 grid w-[min(420px,92vw)] grid-cols-1 gap-3 [@media(max-height:440px)]:mt-3 [@media(max-height:440px)]:gap-2">
                <McSlider
                  label="视野"
                  value={settings.fov}
                  min={50}
                  max={110}
                  format={(v) => (v === 70 ? '正常' : `${v}`)}
                  onChange={(v) => setSettings((s) => ({ ...s, fov: v }))}
                />
                <McSlider
                  label="渲染距离"
                  value={settings.chunks}
                  min={3}
                  max={10}
                  format={(v) => `${v} 区块`}
                  onChange={(v) => setSettings((s) => ({ ...s, chunks: v }))}
                />
                <McSlider
                  label={touch ? '视角灵敏度' : '鼠标灵敏度'}
                  value={settings.sens}
                  min={0.25}
                  max={2.5}
                  step={0.05}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setSettings((s) => ({ ...s, sens: v }))}
                />
              </div>
              <div className="mt-10 mb-4 w-[min(420px,92vw)] [@media(max-height:440px)]:mt-4">
                <McButton onClick={() => go(optionsFrom.current)}>完成</McButton>
              </div>
            </>
          )
          return optionsFrom.current === 'paused' ? (
            <div className="menu-scroll absolute inset-0 z-20 flex flex-col items-center bg-black/60">{body}</div>
          ) : (
            <DirtScreen>{body}</DirtScreen>
          )
        })()}

      {/* ------------------------------ LOADING ------------------------------ */}
      {screen === 'loading' && (
        <DirtScreen dim={0.5}>
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="mc-text text-[22px] font-semibold">正在加载世界</div>
            <div className="mc-text mt-2 text-[16px]">生成地形中...{Math.round(progress * 100)}%</div>
            <div className="mt-4 h-[10px] w-[min(380px,80vw)] border-2 border-black bg-[#2b2b2b]">
              <div className="h-full bg-[#5fd13c]" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
          <div className="mc-text mb-8 max-w-[92vw] px-4 text-center text-[14px] text-[#cfcfcf]">
            {touch ? TIPS_TOUCH : TIPS}
            {touch && <div className="portrait-only mt-2 text-[#ffff55]">建议把设备横过来玩,操作更舒服</div>}
          </div>
        </DirtScreen>
      )}

      {/* ------------------------------ HUD ------------------------------ */}
      {inGame && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {info.underwater && <div className="absolute inset-0 bg-[#1b4fd6]/35" />}
          <div className="mc-text safe-tl absolute text-[14px] leading-5">
            <div>Minecraft 1.20.4 (web/vanilla)</div>
            <div>{info.text}</div>
          </div>
          {/* crosshair */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mix-blend-difference">
            <div className="absolute h-[2px] w-[18px] -translate-x-1/2 -translate-y-1/2 bg-white" />
            <div className="absolute h-[18px] w-[2px] -translate-x-1/2 -translate-y-1/2 bg-white" />
          </div>
          {/* hotbar */}
          <div
            className="absolute left-1/2 flex -translate-x-1/2 border-2 border-black bg-[#8b8b8b] p-[3px]"
            style={
              {
                bottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
                // 触屏:根据屏幕宽度缩放快捷栏,给两侧按键留出空间
                '--slot': touch ? 'clamp(28px, calc((100vw - 400px) / 9), 46px)' : '46px',
              } as CSSProperties
            }
          >
            {HOTBAR.map((b, i) => (
              <div
                key={i}
                className={`hotbar-slot relative flex h-[var(--slot)] w-[var(--slot)] items-center justify-center bg-[#8b8b8b] ${touch ? 'pointer-events-auto touch-none' : ''}`}
                onPointerDown={touch ? () => engineRef.current?.selectSlot(i) : undefined}
                style={
                  i === slot
                    ? { outline: '4px solid #fff', outlineOffset: '-2px', zIndex: 1, boxShadow: '0 0 0 2px #000, inset 2px 2px 0 #373737, inset -2px -2px 0 #fff' }
                    : undefined
                }
              >
                <img src={blockIcon(b)} alt="" className="h-[83%] w-[83%]" style={{ imageRendering: 'pixelated' }} />
                <span className="absolute top-0 left-[3px] text-[10px] text-white/80">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------- TOUCH CONTROLS ---------------------------- */}
      {touch && screen === 'playing' && (
        <TouchControls engineRef={engineRef} flying={info.fly} onPause={() => go('paused')} />
      )}

      {/* ------------------------------ PAUSE ------------------------------ */}
      {screen === 'paused' && (
        <div className="menu-scroll absolute inset-0 z-20 flex flex-col items-center bg-black/55">
          <h2 className="mc-text mt-[12vh] text-[22px] font-semibold [@media(max-height:440px)]:mt-4">游戏菜单</h2>
          <div className="mt-6 flex w-[min(400px,90vw)] flex-col gap-2">
            <McButton onClick={resume}>回到游戏</McButton>
            <McButton onClick={() => openOptions('paused')}>选项...</McButton>
            <McButton onClick={toTitle} className="mt-4">
              保存并退出到标题屏幕
            </McButton>
          </div>
          <div className="mc-text mt-8 mb-4 max-w-[92vw] px-4 text-center text-[14px] text-[#cfcfcf] [@media(max-height:440px)]:mt-4">
            {touch ? TIPS_TOUCH : TIPS}
          </div>
        </div>
      )}

      {/* ------------------------------ QUIT ------------------------------ */}
      {screen === 'quit' && (
        <div
          className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center bg-black"
          onClick={() => go('title')}
        >
          <div className="mc-text text-[22px]">感谢游玩!你现在可以关闭这个标签页了。</div>
          <div className="mc-text mt-3 text-[14px] text-[#9a9a9a]">点击任意处返回标题屏幕</div>
        </div>
      )}

      {/* fade in from black on load */}
      <div
        className="pointer-events-none absolute inset-0 z-40 bg-black"
        style={{ animation: 'fade-from-black 1.6s ease-out forwards' }}
      />
    </div>
  )
}
