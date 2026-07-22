# yt-downloader

A tiny Node.js script that downloads a YouTube video, converts it to a 9:16
portrait video (Reels/TikTok orientation), and can chop it into short clips.

## Requirements

Both must be installed (macOS via Homebrew):

```bash
brew install yt-dlp ffmpeg
```

## Usage

```bash
npm run download
```

Then paste the YouTube URL when prompted. You can also pass it inline:

```bash
node index.js "https://www.youtube.com/watch?v=..."
```

## What it does

1. **Download** – saves an `.mp4` (up to 720p) into `downloads/`.
2. **Convert to portrait** – produces a 1080×1920 (9:16) version with the full
   video centered and black bars on the top and bottom. Videos that are already
   portrait/square are left as-is.
3. **Split (optional)** – enter a length in minutes (e.g. `1` or `2`) to cut the
   video into sequential clips covering the whole thing; press Enter to skip.
   Clips land in a `… - segments/` folder.

## Notes

- Portrait conversion re-encodes the video (`libx264`). Splitting is lossless
  (`-c copy`), so cut boundaries snap to the nearest keyframe — clip lengths are
  approximate but no footage is dropped.
- If a download ever fails, update yt-dlp first: `brew upgrade yt-dlp`.

## Tests

```bash
npm test
```

Tests use ffmpeg to generate small local clips (no network / YouTube access
needed) and verify dimension detection, portrait conversion, and splitting.
