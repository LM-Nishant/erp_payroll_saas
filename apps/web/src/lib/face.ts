/** In-browser face descriptors (face-api.js). Models are served from /models. */
import type * as FaceApiModule from '@vladmandic/face-api';

type FaceApi = typeof FaceApiModule;

let api: Promise<FaceApi> | null = null;

function loadApi(): Promise<FaceApi> {
  api ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]);
    return faceapi;
  })().catch((e) => {
    api = null;
    throw e;
  });
  return api;
}

export const FACE_MATCH_THRESHOLD = 0.5;

/** 128-number descriptor for the single most prominent face, or null when none is found. */
export async function describeFace(
  input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
): Promise<number[] | null> {
  const faceapi = await loadApi();
  const result = await faceapi
    .detectSingleFace(
      input,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }),
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
  return result ? Array.from(result.descriptor) : null;
}

/** Landmarks of the most prominent face (fast detector for live tracking), or null. */
export async function faceLandmarks(
  input: HTMLVideoElement | HTMLCanvasElement,
): Promise<{ x: number; y: number }[] | null> {
  const faceapi = await loadApi();
  const result = await faceapi
    .detectSingleFace(
      input,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }),
    )
    .withFaceLandmarks();
  return result ? result.landmarks.positions.map((p) => ({ x: p.x, y: p.y })) : null;
}

export async function describeFile(file: Blob): Promise<number[] | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await describeFace(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function faceDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum);
}
