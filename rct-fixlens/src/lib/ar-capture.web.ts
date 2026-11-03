import type { Photo } from "../api/types";
export async function canMeasure(): Promise<boolean> {
  return false;
}
export async function captureMeasuredPhoto(): Promise<Photo | null> {
  throw new Error("Use a reference card to add measurements to this photo.");
}
