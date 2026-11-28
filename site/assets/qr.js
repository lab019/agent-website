/*
 * Small QR code encoder for the site, with no dependency (ISO/IEC 18004): byte mode, error correction level M,
 * versions 1 to 6 (up to 106 bytes), enough for the short links the home shows as a QR code. The mask is the one
 * with the lowest penalty score. qrSvg() returns the SVG markup; the other exports are what the node tests check
 * (tests/sdk/qr.test.mjs).
 */

// Level M, versions 1..6: [total codewords, EC codewords per block, blocks]. In these versions all blocks are equal.
const LEVEL_M = [null, [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2], [172, 16, 4]]
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]]
const MAX_VERSION = 6

function dataCapacity(version) {
  const [total, ec, blocks] = LEVEL_M[version]
  return total - ec * blocks
}

// Smallest version whose data codewords hold the mode (4 bits), the 8-bit length and the bytes; null when too long.
export function chooseVersion(byteLength) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    if (4 + 8 + byteLength * 8 <= dataCapacity(version) * 8) return version
  }
  return null
}

// Byte mode segment, terminator, padding to a byte, then the 0xEC/0x11 pad codewords up to the version's capacity.
export function dataCodewords(bytes, version) {
  const capacity = dataCapacity(version)
  const bits = []
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, 8)
  bytes.forEach((b) => push(b, 8))
  push(0, Math.min(4, capacity * 8 - bits.length))
  while (bits.length % 8) bits.push(0)
  const out = []
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0))
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad)
  return out
}

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMultiply(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

// Reed–Solomon error correction codewords of `data`.
export function reedSolomon(data, degree) {
  const divisor = rsDivisor(degree)
  const result = new Array(degree).fill(0)
  for (const b of data) {
    const factor = b ^ result.shift()
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor)
    })
  }
  return result
}

function interleave(data, version) {
  const [, ec, blocks] = LEVEL_M[version]
  const size = data.length / blocks
  const groups = []
  for (let b = 0; b < blocks; b += 1) {
    const chunk = data.slice(b * size, (b + 1) * size)
    groups.push([chunk, reedSolomon(chunk, ec)])
  }
  const out = []
  for (let i = 0; i < size; i += 1) groups.forEach(([chunk]) => out.push(chunk[i]))
  for (let i = 0; i < ec; i += 1) groups.forEach(([, ecc]) => out.push(ecc[i]))
  return out
}

// 15 format bits for level M (indicator 00) and the mask, BCH-protected and XORed with 0x5412.
export function formatBits(mask) {
  const data = (0b00 << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

function grid(size, value) {
  return Array.from({ length: size }, () => new Array(size).fill(value))
}

function drawFormat(modules, fixed, bits) {
  const size = modules.length
  const set = (x, y, dark) => {
    modules[y][x] = dark
    fixed[y][x] = true
  }
  const bit = (i) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i += 1) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true) // the dark module
}

function functionPatterns(version) {
  const size = version * 4 + 17
  const modules = grid(size, false)
  const fixed = grid(size, false)
  const set = (x, y, dark) => {
    modules[y][x] = dark
    fixed[y][x] = true
  }
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const ring = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, ring !== 2 && ring !== 4)
      }
    }
  }
  const centres = ALIGNMENT[version]
  const last = centres.length - 1
  centres.forEach((ay, i) => {
    centres.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    })
  })
  drawFormat(modules, fixed, 0) // reserves the format areas
  return { modules, fixed }
}

function placeCodewords(modules, fixed, codewords) {
  const size = modules.length
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    const upward = ((right + 1) & 2) === 0
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j += 1) {
        const x = right - j
        if (fixed[y][x] || i >= codewords.length * 8) continue
        modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
        i += 1
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function penalty(modules) {
  const size = modules.length
  let score = 0
  const lines = []
  for (let i = 0; i < size; i += 1) {
    lines.push(modules[i])
    lines.push(modules.map((row) => row[i]))
  }
  const finderLike = [true, false, true, true, true, false, true]
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) run += 1
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    for (let i = 0; i + 7 <= size; i += 1) {
      if (!finderLike.every((dark, k) => line[i + k] === dark)) continue
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || !line[i - k])
      const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= size || !line[i + 7 + k])
      if (lightBefore || lightAfter) score += 40
    }
  }
  for (let y = 0; y + 1 < size; y += 1) {
    for (let x = 0; x + 1 < size; x += 1) {
      const c = modules[y][x]
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

// The modules of the QR code of `text` (true = dark), without the quiet zone. Throws when the text is too long.
export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text)))
  const version = chooseVersion(bytes.length)
  if (!version) throw new RangeError('text too long for a version 1-6 QR code')
  const codewords = interleave(dataCodewords(bytes, version), version)
  const base = functionPatterns(version)
  placeCodewords(base.modules, base.fixed, codewords)
  let best = null
  MASKS.forEach((rule, mask) => {
    const modules = base.modules.map((row, y) => row.map((dark, x) => (base.fixed[y][x] ? dark : dark !== rule(x, y))))
    drawFormat(modules, grid(modules.length, false), formatBits(mask))
    const score = penalty(modules)
    if (!best || score < best.score) best = { score, modules }
  })
  return best.modules
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// SVG of the QR code with a white quiet zone of `border` modules; one path, one horizontal run per segment.
export function qrSvg(text, { label = 'Código QR', border = 4 } = {}) {
  const modules = qrMatrix(text)
  const size = modules.length + border * 2
  let path = ''
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (!row[x]) {
        x += 1
        continue
      }
      let end = x
      while (end < row.length && row[end]) end += 1
      path += `M${x + border} ${y + border}h${end - x}v1h-${end - x}z`
      x = end
    }
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeAttr(label)}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/><path d="${path}" fill="#0f1720"/></svg>`
  )
}
