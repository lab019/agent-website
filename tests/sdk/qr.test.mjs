// The site's QR code encoder (site/assets/qr.js): byte mode, level M, versions 1-6. Checked against the ISO/IEC 18004
// Reed–Solomon example and the standard format-information table; the decode of a real code is checked in the browser
// (BarcodeDetector) and shown in the PR. The module is copied to a .mjs file so node loads it as ESM.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const target = join(mkdtempSync(join(tmpdir(), 'lab019-qr-')), 'qr.mjs')
copyFileSync(fileURLToPath(new URL('../../site/assets/qr.js', import.meta.url)), target)
const { reedSolomon, formatBits, chooseVersion, dataCodewords, qrMatrix, qrSvg } = await import(pathToFileURL(target).href)

test('Reed–Solomon matches the ISO/IEC 18004 example (1-M, "01234567")', () => {
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]
  assert.deepEqual(reedSolomon(data, 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55])
})

test('format information for level M matches the standard table', () => {
  const table = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000']
  table.forEach((bits, mask) => assert.equal(formatBits(mask).toString(2).padStart(15, '0'), bits, `mask ${mask}`))
})

test('the smallest version that holds the bytes, up to version 6', () => {
  const limits = [[1, 14], [2, 26], [3, 42], [4, 62], [5, 84], [6, 106]]
  for (const [version, max] of limits) {
    assert.equal(chooseVersion(max), version, `${max} bytes`)
    assert.equal(chooseVersion(max + 1), version === 6 ? null : version + 1, `${max + 1} bytes`)
  }
  assert.throws(() => qrMatrix('x'.repeat(107)), RangeError)
  // "A" in version 1: mode 0100, length 00000001, 01000001, terminator, then the 0xEC/0x11 pads
  assert.deepEqual(dataCodewords([0x41], 1), [0x40, 0x14, 0x10, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec])
})

test('the WhatsApp call link becomes a version 3 code with every function pattern in place', () => {
  const m = qrMatrix('https://wa.me/call/5511900000000')
  const size = m.length
  assert.equal(size, 29)
  const at = (x, y) => m[y][x]
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = 0; dy < 7; dy += 1) {
      for (let dx = 0; dx < 7; dx += 1) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
        assert.equal(at(ox + dx, oy + dy), ring !== 2, `finder at ${ox},${oy}`)
      }
    }
  }
  for (let i = 0; i < 8; i += 1) {
    assert.equal(at(7, i), false, 'separator')
    assert.equal(at(size - 8, i), false, 'separator')
    assert.equal(at(i, size - 8), false, 'separator')
  }
  for (let i = 8; i < size - 8; i += 1) {
    assert.equal(at(i, 6), i % 2 === 0, 'horizontal timing')
    assert.equal(at(6, i), i % 2 === 0, 'vertical timing')
  }
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) assert.equal(at(22 + dx, 22 + dy), Math.max(Math.abs(dx), Math.abs(dy)) !== 1, 'alignment')
  }
  assert.equal(at(8, size - 8), true, 'dark module')
  // both copies of the format information carry the same valid word
  let first = 0
  let second = 0
  const firstCopy = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]
  firstCopy.forEach(([x, y], i) => (first |= (at(x, y) ? 1 : 0) << i))
  for (let i = 0; i < 8; i += 1) second |= (at(size - 1 - i, 8) ? 1 : 0) << i
  for (let i = 8; i < 15; i += 1) second |= (at(8, size - 15 + i) ? 1 : 0) << i
  assert.equal(first, second)
  assert.ok([0, 1, 2, 3, 4, 5, 6, 7].some((mask) => formatBits(mask) === first), 'a level M format word')
})

test('the SVG keeps a quiet zone, sharp modules and a label', () => {
  const svg = qrSvg('https://wa.me/call/5511900000000', { label: 'Código "QR" <teste>' })
  assert.match(svg, /^<svg [^>]*viewBox="0 0 37 37"/) // 29 modules + 4 on each side
  assert.match(svg, /role="img" aria-label="Código &quot;QR&quot; &lt;teste>"/)
  assert.match(svg, /shape-rendering="crispEdges"/)
  assert.match(svg, /<rect width="37" height="37" fill="#ffffff"\/><path d="M4 4h7v1h-7z/) // the top-left finder starts at the quiet zone
})
