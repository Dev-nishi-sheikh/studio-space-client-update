import { API_BASE_URL, isDemoMode } from "./api";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That image could not be read."));

    reader.readAsDataURL(file);
  });
}

async function compress(file: File, maxWidth = 1400): Promise<string> {
  const dataUrl = await readAsDataUrl(file);

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();

    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("That image file looks corrupted."));

    element.src = dataUrl;
  });

  const scale = Math.min(1, maxWidth / image.width);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) return dataUrl;

  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.82);
}

export async function uploadStudioImage(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Please choose a JPEG, PNG, WebP, AVIF or GIF image.");
  }

  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Image must be 5MB or smaller.");
  }

  // Local demo mode only.
  if (isDemoMode) {
    return compress(file);
  }

  // Production/local API mode: upload through our Express backend.
  const body = new FormData();
  body.append("image", file);

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/uploads`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
      body,
    });
  } catch {
    throw new Error("Could not reach the image upload server.");
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        "Image upload failed. Please try again.",
    );
  }

  const imageURL = payload?.data?.url;

  if (typeof imageURL !== "string" || !/^https?:\/\//i.test(imageURL)) {
    throw new Error("The server returned an invalid image URL.");
  }

  return imageURL;
}