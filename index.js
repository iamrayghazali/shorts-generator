const { spawn } = require('child_process')
const readline = require('readline')
const path = require('path')
const fs = require('fs')

const DOWNLOAD_DIR = path.join(__dirname, 'downloads')

// Run a command and stream its output straight to the terminal.
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
  })
}

// Capture a command's stdout (used for ffprobe).
function capture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args)
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
  })
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()) }))
}

async function download(url) {
  const outputTemplate = path.join(DOWNLOAD_DIR, '%(title)s.%(ext)s')

  // Target 720p: grab the best video up to 720p (falls back to the highest
  // available if the video maxes out below 720), plus best audio, merged to mp4.
  const format = 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b'
  const formatArgs = [
    '-f', format,
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    url,
  ]

  console.log('\n⬇️  Downloading (up to 720p)...\n')
  await run('yt-dlp', formatArgs)

  // Find the most recently written file in the download folder — that's ours.
  return newestFile(DOWNLOAD_DIR)
}

function newestFile(dir) {
  const files = fs.readdirSync(dir)
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return files[0] || null
}

// Returns { width, height } of the video's first video stream.
async function getDimensions(filePath) {
  const out = await capture('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    filePath,
  ])
  const [width, height] = out.split(',').map((n) => parseInt(n, 10))
  return { width, height }
}

// Convert a landscape video to 9:16 portrait: full width, centered, with
// black bars top and bottom. Returns the new file path. If the video is
// already portrait (or square), returns the original path untouched.
async function toPortrait(filePath) {
  const { width, height } = await getDimensions(filePath)
  if (!width || !height || height >= width) {
    console.log('\n↔️  Already portrait/square — skipping conversion.')
    return filePath
  }

  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outPath = path.join(dir, `${base} - portrait.mp4`)

  console.log('\n📱 Converting to portrait (9:16, black bars top & bottom)...\n')
  // Fit the full-width video into a 1080x1920 frame, keeping aspect ratio,
  // then pad the leftover top/bottom space with black, centered.
  await run('ffmpeg', [
    '-i', filePath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:-1:-1:color=black,setsar=1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k',
    '-y', outPath,
  ])

  console.log(`\n✅ Portrait version: ${outPath}`)
  return outPath
}

async function split(filePath, seconds) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  const outDir = path.join(dir, `${base} - segments`)
  fs.mkdirSync(outDir, { recursive: true })

  const outputTemplate = path.join(outDir, `Part %d - ${base}.mp4`)

  console.log(`\n✂️  Splitting into ~${seconds}s segments...\n`)
  // -c copy = lossless & fast. Cuts happen at keyframes, so segments are
  // approximately (not exactly) `seconds` long, but nothing is dropped.
  // Clips are named "Part 1 - <title>.mp4", "Part 2 - <title>.mp4", ...
  await run('ffmpeg', [
    '-i', filePath,
    '-c', 'copy',
    '-map', '0',
    '-segment_time', String(seconds),
    '-f', 'segment',
    '-reset_timestamps', '1',
    '-segment_start_number', '1',
    outputTemplate,
  ])

  console.log(`\n✅ Segments saved to: ${outDir}`)
  return outDir
}

async function main() {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })

  const url = process.argv[2] || (await ask('Paste the YouTube URL: '))
  if (!url) {
    console.error('No URL provided.')
    process.exit(1)
  }

  let filePath = await download(url)
  console.log(`\n✅ Downloaded: ${filePath || DOWNLOAD_DIR}`)

  if (filePath) {
    filePath = await toPortrait(filePath)

    const answer = (await ask('\nSplit into short clips? Enter length in minutes (e.g. 1 or 2), or press Enter to skip: '))
    const minutes = parseFloat(answer)
    if (answer && !Number.isNaN(minutes) && minutes > 0) {
      await split(filePath, Math.round(minutes * 60))
    }
  }
}

// Only run the interactive flow when executed directly (not when required by tests).
if (require.main === module) {
  main().catch((err) => {
    console.error(`\n❌ ${err.message}`)
    process.exit(1)
  })
}

module.exports = { run, capture, newestFile, getDimensions, toPortrait, split }
