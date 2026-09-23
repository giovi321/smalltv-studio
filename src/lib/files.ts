/* Import / export: files in, packages and previews out. Everything stays in the browser. */
import * as C from '../core/core';
import type { Asset, Assets, Theme } from '../core/types';
import pixelRoom from '../../fixtures/pixel-room.stheme';
import terminalOps from '../../fixtures/terminal-ops.stheme';
import liveStatus from '../../fixtures/live-status.stheme';
import * as S from '../store/studio';

interface Example { name: string; blurb: string; data: string; sample?: Record<string, string> }
export const EXAMPLES: Record<'pixel-room' | 'terminal-ops' | 'live-status', Example> = {
  'pixel-room': { name: 'Pixel Room', blurb: 'Image, animated cat, clock and date', data: pixelRoom },
  'terminal-ops': { name: 'Terminal Ops', blurb: 'Dense text and line dashboard', data: terminalOps },
  'live-status': {
    name: 'Live Status', blurb: 'Scrolling text and a bar driven by live data', data: liveStatus,
    // The firmware's own preview values for this example.
    sample: { 'status.label': 'SmallTV dynamic dashboard headline', 'status.level': '82', 'status.state': 'Warning' },
  },
};
export type ExampleId = keyof typeof EXAMPLES;

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
export const isImage = (f: File) => IMAGE_RE.test(f.name);
export const isPackage = (f: File) => /\.(stheme|json)$/i.test(f.name);

/* ---------- plumbing ---------- */
export function download(data: BlobPart | Blob, name: string, type: string) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/* Opens the browser's file picker. Must run inside a user gesture. */
export function pickFiles({ accept = '', multiple = false, directory = false } = {}): Promise<File[]> {
  return new Promise(resolve => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    if (directory) input.webkitdirectory = true;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
/* Runs a long task with the workspace locked; errors become an error notice. */
export async function operation(work: () => Promise<void>) {
  if (S.useStudio.getState().busy) return;
  S.setBusy(true);
  try { await work(); } catch (error) { S.notify((error as Error).message, true); } finally { S.setBusy(false); }
}
export const confirmReplace = () => !S.useStudio.getState().dirty || confirm('Replace the current theme? Changes that were not exported will be lost.');

/* ---------- images ---------- */
async function decodeFile(file: File): Promise<{ asset: Asset; scaled: boolean }> {
  if (file.size > 10 * 1024 * 1024) throw Error(file.name + ': file too large (10 MiB maximum).');
  if (!isImage(file)) throw Error('Use PNG, JPEG or WebP images.');
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    let width = bitmap.width, height = bitmap.height;
    const scaled = width > 240 || height > 240;
    if (scaled) { const k = Math.min(240 / width, 240 / height); width = Math.max(1, Math.floor(width * k)); height = Math.max(1, Math.floor(height * k)); }
    const surface = Object.assign(document.createElement('canvas'), { width, height });
    const context = surface.getContext('2d', { willReadFrequently: true })!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return { asset: C.fromRGBA(width, height, context.getImageData(0, 0, width, height).data), scaled };
  } finally { bitmap.close(); }
}
/* Imports files into the selected image or animation layer. Frames are sorted by name. */
export async function importAssets(files: File[]) {
  const s = S.useStudio.getState(), l = S.selectedLayer(s), index = s.selected;
  if (!l || !files.length || (l.type !== 'image' && l.type !== 'animation')) return;
  if (l.type === 'image' && files.length !== 1) throw Error('Choose a single image.');
  if (files.length > 240) throw Error('240 frames maximum.');
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  S.notify('Importing images…');
  const imported: Asset[] = [];
  let bytes = 0, scaled = false;
  for (const file of sorted) {
    const result = await decodeFile(file);
    scaled ||= result.scaled;
    if (imported.length && (result.asset.width !== imported[0].width || result.asset.height !== imported[0].height)) throw Error('All frames must have the same size.');
    bytes += C.encodeImage(result.asset).length;
    if (bytes > C.MAX_PACKAGE) throw Error('These images exceed the 3 MiB package limit.');
    imported.push(result.asset);
  }
  S.setLayerAssets(index, imported);
  S.notify(imported.length + ' image' + (imported.length === 1 ? '' : 's') + ' imported and converted to RGB565.' + (scaled ? ' Larger images were scaled down to fit 240 × 240.' : ''));
}
export async function pickAssets(forType: 'image' | 'animation') {
  const files = await pickFiles({ accept: 'image/png,image/jpeg,image/webp', multiple: forType === 'animation' });
  if (files.length) await operation(() => importAssets(files));
}

/* ---------- projects ---------- */
function parseManifest(text: string): Theme {
  const theme = JSON.parse(text), errors = C.validate(theme);
  if (errors.length) throw Error(errors.join('\n'));
  return theme;
}
export async function openFile(file: File) {
  if (file.name.toLowerCase().endsWith('.stheme')) {
    if (file.size > C.MAX_PACKAGE) throw Error('The package exceeds 3 MiB.');
    S.load(C.unpack(await file.arrayBuffer()), 'Theme imported: ' + file.name);
  } else {
    if (file.size > C.MAX_MANIFEST) throw Error('theme.json exceeds 16 KiB.');
    S.load({ theme: parseManifest(await file.text()), assets: new Map() }, 'Manifest imported. Import missing images, or open the whole source folder.');
  }
}
export async function openFolder(files: File[]) {
  const manifests = files.filter(f => f.name === 'theme.json');
  if (manifests.length !== 1) throw Error('Choose a folder that contains exactly one theme.json.');
  const manifest = manifests[0];
  if (manifest.size > C.MAX_MANIFEST) throw Error('theme.json exceeds 16 KiB.');
  const theme = parseManifest(await manifest.text());
  const prefix = manifest.webkitRelativePath.slice(0, -'theme.json'.length), lookup = new Map(files.map(f => [f.webkitRelativePath, f]));
  const assets: Assets = new Map();
  let bytes = 0;
  for (const l of theme.layers) for (const path of C.framePaths(l)) {
    if (assets.has(path)) continue;
    const file = lookup.get(prefix + path.slice(0, -4));
    if (!file) throw Error('Missing asset: ' + path.slice(0, -4));
    const { asset } = await decodeFile(file);
    bytes += C.encodeImage(asset).length;
    if (bytes > C.MAX_PACKAGE || assets.size >= 255) throw Error('The folder exceeds the 3 MiB / 256 entry limits.');
    assets.set(path, asset);
  }
  C.pack(theme, assets);
  S.load({ theme, assets }, 'Source folder imported, including images and animations.');
}
export function loadExample(id: ExampleId) {
  const bytes = Uint8Array.from(atob(EXAMPLES[id].data), c => c.charCodeAt(0));
  S.load(C.unpack(bytes), EXAMPLES[id].name + ' loaded. Edit its layers to make it yours.');
  for (const [key, value] of Object.entries(EXAMPLES[id].sample ?? {})) S.setSample(key, value);
}
export async function openPackageDialog() {
  const [file] = await pickFiles({ accept: '.stheme,.json' });
  if (file && confirmReplace()) await operation(() => openFile(file));
}
export async function openFolderDialog() {
  const files = await pickFiles({ directory: true, multiple: true });
  if (files.length && confirmReplace()) await operation(() => openFolder(files));
}

/* ---------- export ---------- */
export function exportPackage() {
  const s = S.useStudio.getState();
  if (s.problems.length || !s.packed) { S.notify('Fix the listed issues before exporting.', true); return; }
  download(s.packed, s.theme.theme.id + '.stheme', 'application/octet-stream');
  S.markSaved();
  S.notify('Package exported. Install it on the TV under Display → Theme clocks.');
}
export function saveManifest() {
  download(JSON.stringify(S.useStudio.getState().theme, null, 2) + '\n', 'theme.json', 'application/json');
  S.notify('Manifest saved. Export the .stheme package to keep images.');
}
export function savePreview() {
  let pixels: Uint8ClampedArray<ArrayBuffer>;
  try { pixels = S.renderFrame(); } catch (error) { S.notify((error as Error).message, true); return; }
  const canvas = Object.assign(document.createElement('canvas'), { width: 240, height: 240 });
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, 240, 240), 0, 0);
  canvas.toBlob(blob => {
    if (!blob) return;
    download(blob, S.useStudio.getState().theme.theme.id + '-preview.png', 'image/png');
    S.notify('Preview image saved.');
  }, 'image/png');
}
