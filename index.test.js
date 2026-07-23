const { test, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { run, newestFile, getDimensions, toPortrait, split } = require('./index')

let workDir
let landscape // 1280x720
let portrait // 720x1280

// Build small test clips with ffmpeg so tests need no network / YouTube.
before(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-test-'))

  landscape = path.join(workDir, 'landscape.mp4')
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    // Force a keyframe every second so lossless (-c copy) splitting can cut there.
    '-force_key_frames', 'expr:gte(t,n_forced*1)',
    '-c:v', 'libx264', '-c:a', 'aac', '-y', landscape,
  ])

  portrait = path.join(workDir, 'portrait.mp4')
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-c:a', 'aac', '-y', portrait,
  ])
})

after(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

test('getDimensions reads video width and height', async () => {
  const dims = await getDimensions(landscape)
  assert.deepStrictEqual(dims, { width: 1280, height: 720 })
})

test('newestFile returns the most recently modified file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-newest-'))
  fs.writeFileSync(path.join(dir, 'old.txt'), 'a')
  const newer = path.join(dir, 'new.txt')
  fs.writeFileSync(newer, 'b')
  // Force new.txt to be strictly newer regardless of filesystem timestamp resolution.
  const later = new Date(Date.now() + 10000)
  fs.utimesSync(newer, later, later)

  assert.strictEqual(newestFile(dir), newer)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('toPortrait converts landscape to 1080x1920 with black bars', async () => {
  const out = await toPortrait(landscape)
  assert.notStrictEqual(out, landscape, 'should produce a new file')
  assert.ok(fs.existsSync(out), 'portrait file should exist')

  const dims = await getDimensions(out)
  assert.deepStrictEqual(dims, { width: 1080, height: 1920 })
})

test('toPortrait leaves an already-portrait video untouched', async () => {
  const out = await toPortrait(portrait)
  assert.strictEqual(out, portrait, 'should return the original path unchanged')
})

test('split cuts a video into multiple sequential clips covering the whole thing', async () => {
  // 4s clip split into ~1s segments => several parts, none dropped.
  const outDir = await split(landscape, 1)
  const parts = fs.readdirSync(outDir).filter((f) => f.endsWith('.mp4')).sort()

  assert.ok(parts.length >= 2, `expected multiple parts, got ${parts.length}`)
  assert.strictEqual(parts[0], '001.mp4')

  // Sum of segment durations should be within a small tolerance of the original.
  const total = (await getDimensions(landscape)) && 4
  let sum = 0
  for (const p of parts) {
    const { capture } = require('./index')
    const dur = await capture('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', path.join(outDir, p),
    ])
    sum += parseFloat(dur)
  }
  assert.ok(Math.abs(sum - total) < 1, `segment durations (${sum.toFixed(2)}s) should cover the ~${total}s source`)
})
