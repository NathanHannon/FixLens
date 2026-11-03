import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { Photo } from "@/api/types";

export async function preparePhoto(
  asset: ImagePicker.ImagePickerAsset,
): Promise<Photo> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > 2000) {
    context.resize(
      asset.width >= asset.height ? { width: 2000 } : { height: 2000 },
    );
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.85,
  });
  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    takenAt: new Date().toISOString(),
  };
}
export async function pickPhoto(camera: boolean): Promise<Photo | null> {
  if (camera && process.env.EXPO_OS !== "web") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted)
      throw new Error(
        "Camera access is off. Enable it in Settings, or choose a photo from your library.",
      );
  }
  const result = await (
    camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync
  )({
    mediaTypes: ["images"],
    quality: 1,
    allowsMultipleSelection: false,
    exif: true,
  });
  if (result.canceled) return null;
  return preparePhoto(result.assets[0]);
}
