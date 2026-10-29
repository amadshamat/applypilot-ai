// Turns the frames and captions recorded by tests/e2e/demo-video.spec.ts into
// demo-output/applypilot-ai-demo.mp4: a title card, the browser (left) and the
// side panel (right) side by side with a caption bar, and a closing card.
// Needs ffmpeg with libx264 on the PATH (macOS: brew install ffmpeg).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../../demo-output');
const timeline = JSON.parse(readFileSync(resolve(OUT, 'timeline.json'), 'utf8'));
const { start, end, left, panel, frames, captions } = timeline;

const WIDTH = left.width + panel.width;
const BAR = 80;
const HEIGHT = Math.max(left.height, panel.height) + BAR;
const FPS = 30;
const CARD_SECONDS = 5;
const BACKGROUND = '0x0f172a';

const FONTS = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  'C:/Windows/Fonts/arial.ttf',
];
const font = process.env.DEMO_FONT ?? FONTS.find((f) => existsSync(f));
if (!font) throw new Error('No font found. Set DEMO_FONT to a .ttf file.');

/** An ffmpeg concat list showing each frame until the next one arrives. */
function concatList(name) {
  const list = frames[name];
  if (list.length === 0) throw new Error(`No frames were recorded for ${name}.`);
  const lines = [];
  list.forEach((frame, i) => {
    const from = i === 0 ? start : frame.t;
    const to = i + 1 < list.length ? list[i + 1].t : end;
    lines.push(`file '${frame.file}'`, `duration ${(Math.max(to - from, 1) / 1000).toFixed(3)}`);
  });
  // The concat demuxer ignores the last duration unless the file is repeated.
  lines.push(`file '${list.at(-1).file}'`);
  writeFileSync(resolve(OUT, `${name}.txt`), `${lines.join('\n')}\n`);
  return `${name}.txt`;
}

/** Text goes through files so quotes, colons and commas need no escaping. */
let textFiles = 0;
function textFile(text) {
  const name = `text-${textFiles++}.txt`;
  writeFileSync(resolve(OUT, name), text);
  return name;
}

const draw = (text, size, y, color = 'white', extra = '') =>
  `drawtext=fontfile='${font}':textfile=${textFile(text)}:fontsize=${size}:fontcolor=${color}:line_spacing=8:x=(w-text_w)/2:y=${y}${extra}`;

const duration = (end - start) / 1000;
const bars = captions.map((c, i) => {
  const from = (c.t - start) / 1000;
  const to = i + 1 < captions.length ? (captions[i + 1].t - start) / 1000 : duration;
  return `drawtext=fontfile='${font}':textfile=${textFile(c.text)}:fontsize=20:fontcolor=white:line_spacing=6:x=24:y=${HEIGHT - BAR}+(${BAR}-text_h)/2:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`;
});

const intro = [
  draw('ApplyPilot AI', 64, '(h/2)-150'),
  draw('A human-in-the-loop job application copilot for Chrome', 30, '(h/2)-50', '0xcbd5e1'),
  draw(
    'Job analysis  ·  Resume tailoring  ·  Assisted autofill  ·  Application tracking',
    24,
    '(h/2)+20',
    '0x93c5fd',
  ),
  draw(
    'Automated demo with fictional data and the free local mock AI (no paid API calls)',
    20,
    '(h/2)+110',
    '0x94a3b8',
  ),
].join(',');

const outro = [
  draw('ApplyPilot AI v1.0.0', 56, '(h/2)-140'),
  draw(
    'TypeScript · React · Chrome Manifest V3 · Node.js · Claude API · AWS CDK',
    24,
    '(h/2)-40',
    '0xcbd5e1',
  ),
  draw('Nothing is submitted or claimed without your approval.', 24, '(h/2)+10', '0x93c5fd'),
  draw(
    'Cloud sync (AWS) is built and tested locally only, not deployed.',
    20,
    '(h/2)+90',
    '0x94a3b8',
  ),
].join(',');

const filter = [
  `[0:v]fps=${FPS},scale=${left.width}:${left.height}:force_original_aspect_ratio=decrease,pad=${left.width}:${left.height}[l]`,
  `[1:v]fps=${FPS},scale=${panel.width}:${panel.height}:force_original_aspect_ratio=decrease,pad=${panel.width}:${panel.height}[r]`,
  `[l][r]hstack=inputs=2,pad=${WIDTH}:${HEIGHT}:0:0:color=${BACKGROUND},drawbox=x=${left.width - 1}:y=0:w=2:h=${HEIGHT - BAR}:color=0x334155:t=fill,${bars.join(',')},format=yuv420p,setsar=1[main]`,
  `color=c=${BACKGROUND}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${CARD_SECONDS},${intro},format=yuv420p,setsar=1[intro]`,
  `color=c=${BACKGROUND}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${CARD_SECONDS},${outro},format=yuv420p,setsar=1[outro]`,
  `[intro][main][outro]concat=n=3:v=1:a=0[video]`,
].join(';');
writeFileSync(resolve(OUT, 'filter.txt'), filter);

const output = 'applypilot-ai-demo.mp4';
execFileSync(
  'ffmpeg',
  [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatList('left'),
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatList('panel'),
    '-filter_complex_script',
    'filter.txt',
    '-map',
    '[video]',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '22',
    '-movflags',
    '+faststart',
    output,
  ],
  { cwd: OUT, stdio: 'inherit' },
);
console.log(
  `Wrote demo-output/${output} (${(duration + 2 * CARD_SECONDS).toFixed(0)} s, ${WIDTH}x${HEIGHT}).`,
);
