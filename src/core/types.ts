/* The SmallTV V1 manifest (theme.json) as the firmware defines it. */

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

/* A fetched data field drives one property, either through a linear mapping or through color stops. */
export interface NumericBinding {
  source: string;
  input: [number, number];
  output: [number, number];
  clamp?: boolean;
}
export interface ColorStop {
  at: number;
  value: string;
}
export interface ColorBinding {
  source: string;
  stops: ColorStop[];
}
export type Binding = NumericBinding | ColorBinding;
export type NumericTarget = 'x' | 'y' | 'width' | 'height' | 'radius' | 'cornerRadius' | 'x2' | 'y2' | 'size' | 'strokeWidth' | 'scroll.width' | 'scroll.speed';
export type ColorTarget = 'color' | 'fill' | 'stroke';
export type BindTarget = NumericTarget | ColorTarget;
export type Bindings = Partial<Record<BindTarget, Binding>>;

interface LayerBase {
  id: string;
  x: number;
  y: number;
  bind?: Bindings;
}
/* Horizontal scrolling inside a fixed viewport; `x`, `y` and `anchor` place the viewport. */
export interface Scroll {
  width: number;
  mode: 'loop' | 'bounce';
  speed: number;
  pause?: number;
  gap?: number;
}
export interface TextLayer extends LayerBase {
  type: 'text';
  anchor?: Anchor;
  value: string;
  size: number;
  color: string;
  scroll?: Scroll;
}
export interface ImageLayer extends LayerBase {
  type: 'image';
  source: string;
}
export interface AnimationLayer extends LayerBase {
  type: 'animation';
  source: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  loop: boolean;
}
export type ShapeKind = 'rectangle' | 'circle' | 'line';
export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: ShapeKind;
  width?: number;
  height?: number;
  radius?: number;
  cornerRadius?: number;
  x2?: number;
  y2?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}
export type Layer = TextLayer | ImageLayer | AnimationLayer | ShapeLayer;
export type LayerType = Layer['type'];

export interface DataField {
  id: string;
  path: string;
}
export interface DataSource {
  id: string;
  url: string;
  interval: number;
  insecureTls?: boolean;
  fields: DataField[];
}

export interface Theme {
  spec: 1;
  theme: { id: string; name: string; author: string; version: string };
  display: { width: number; height: number; background: string };
  layers: Layer[];
  data?: DataSource[];
}

/* A decoded STI image: RGB565 colors plus 8-bit alpha, row-major. */
export interface Asset {
  width: number;
  height: number;
  colors: Uint16Array;
  alpha: Uint8Array;
}
/* Compiled package path (for example images/logo.png.sti) -> image. */
export type Assets = Map<string, Asset>;

export interface Project {
  theme: Theme;
  assets: Assets;
}

/* Firmware before commit 0866a70 has no `insecureTls` key and accepts https:// without it.
 * Newer firmware rejects https:// unless `insecureTls` is true. Packages cannot satisfy both. */
export type Target = 'current' | 'legacy';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
