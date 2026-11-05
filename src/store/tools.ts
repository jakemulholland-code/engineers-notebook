import { create } from "zustand";

export type ToolId =
  | "select"
  | "pen"
  | "brush"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "text"
  | "image"
  | "eraser";

export const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  p: "pen",
  b: "brush",
  l: "line",
  a: "arrow",
  r: "rect",
  o: "ellipse",
  t: "text",
  i: "image",
  e: "eraser",
};

type ToolStore = {
  tool: ToolId;
  zoom: number;
  setTool(tool: ToolId): void;
  setZoom(zoom: number): void;
};

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

export const useTools = create<ToolStore>((set) => ({
  tool: "pen",
  zoom: 1,
  setTool: (tool) => set({ tool }),
  setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
}));
