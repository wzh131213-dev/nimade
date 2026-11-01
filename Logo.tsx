import { useEffect, useRef } from 'react'

const GLYPHS: Record<string, string[]> = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
}

const WORD = 'MINECRAFT'
const SCALE = 2
const GAP = 2

function buildGrid() {
  const rows = 7 * SCALE
  const cols = WORD.length * 5 * SCALE + (WORD.length - 1) * GAP
  const grid: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false))
  let ox = 0
  for (const ch of WORD) {
    const g = GLYPHS[ch]
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (g[r][c] === '1')
          for (let dy = 0; dy < SCALE; dy++)
            for (let dx = 0; dx < SCALE; dx++) grid[r * SCALE + dy][ox + c * SCALE + dx] = true
    ox += 5 * SCALE + GAP
  }
  return grid
}

export default function Logo() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const grid = buildGrid()
    const rows = grid.length
    const cols = grid[0].length
    const P = 14
    const pad = 16
    const ext = 12
    canvas.width = cols * P + pad * 2 + ext
    canvas.height = rows * P + pad * 2 + ext
    const ctx = canvas.getContext('2d')!
    const on = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && grid[r][c]

    let seed = 42
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }

    // outline + extrusion silhouette
    ctx.fillStyle = '#000'
    for (let k = 0; k <= ext; k++)
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (grid[r][c]) ctx.fillRect(pad + c * P + k * 0.5 - 4, pad + r * P + k - 4, P + 8, P + 8)

    // extrusion
    for (let k = ext; k >= 1; k--) {
      const v = Math.round(92 - k * 3.2)
      ctx.fillStyle = `rgb(${v},${v},${v + 3})`
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (grid[r][c]) ctx.fillRect(pad + c * P + k * 0.5, pad + r * P + k, P, P)
    }

    // stone faces
    const sub = P / 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[r][c]) continue
        const x = pad + c * P
        const y = pad + r * P
        const base = 128 + rnd() * 16
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++) {
            let v = base + (rnd() - 0.5) * 26
            if (rnd() < 0.12) v -= 22
            ctx.fillStyle = `rgb(${v},${v},${v + 3})`
            ctx.fillRect(x + sx * sub, y + sy * sub, sub, sub)
          }
        // seams
        ctx.fillStyle = 'rgba(0,0,0,0.22)'
        ctx.fillRect(x + P - 1, y, 1, P)
        ctx.fillRect(x, y + P - 1, P, 1)
        // bevels on silhouette edges
        ctx.fillStyle = 'rgba(255,255,255,0.45)'
        if (!on(r - 1, c)) ctx.fillRect(x, y, P, 3)
        if (!on(r, c - 1)) ctx.fillRect(x, y, 3, P)
        ctx.fillStyle = 'rgba(0,0,0,0.38)'
        if (!on(r + 1, c)) ctx.fillRect(x, y + P - 3, P, 3)
        if (!on(r, c + 1)) ctx.fillRect(x + P - 3, y, 3, P)
      }
    }
  }, [])

  return (
    <canvas
      ref={ref}
      className="block h-auto w-[min(820px,92vw)] select-none"
      style={{ imageRendering: 'pixelated', filter: 'drop-shadow(0 8px 10px rgba(0,0,0,0.35))' }}
    />
  )
}
