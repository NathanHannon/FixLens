import { requireOptionalNativeModule } from "expo";
import * as ImagePicker from "expo-image-picker";
import type { CalibrationInput, Photo } from "../api/types";
import { preparePhoto } from "./photos";
const native = requireOptionalNativeModule<{
  isSupported: () => Promise<boolean>;
  capture: () => Promise<{
    uri: string;
    width: number;
    height: number;
    calibration: CalibrationInput;
  } | null>;
}>("FixlensMeasurement");
export async function canMeasure(): Promise<boolean> {
  return native ? native.isSupported().catch(() => false) : false;
}
export async function captureMeasuredPhoto(): Promise<Photo | null> {
  if (!native)
    throw new Error(
      "Surface measurement is unavailable. Take a regular photo and add a reference card instead.",
    );
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted)
    throw new Error(
      "Allow camera access in Settings, or choose an existing photo.",
    );
  const result = await native.capture();
  if (!result) return null;
  const photo = await preparePhoto({
    uri: result.uri,
    width: result.width,
    height: result.height,
  });
  return {
    ...photo,
    calibration: {
      ...result.calibration,
      points: result.calibration.points.map((p) => ({
        x: (p.x * photo.width) / result.width,
        y: (p.y * photo.height) / result.height,
      })),
    },
  };
}
