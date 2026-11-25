// Face detection / recognition helpers (runs 100% in the browser)
import * as faceapi from 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/dist/face-api.esm.js';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1/model/';
let loaded = null;

export function loadModels() {
  loaded ??= (async () => {
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
  })();
  return loaded;
}

const opts = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });

export async function detectFaces(video) {
  return faceapi.detectAllFaces(video, opts()).withFaceLandmarks().withFaceDescriptors();
}

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

// Eye Aspect Ratio — drops sharply when the eyes close (used for blink check)
function ear(eye) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
}
export function eyeOpenness(landmarks) {
  return (ear(landmarks.getLeftEye()) + ear(landmarks.getRightEye())) / 2;
}

// Blink tracker: open -> closed -> open = one blink
export class BlinkDetector {
  constructor() { this.reset(); }
  reset() { this.baseline = null; this.closed = false; this.blinked = false; }
  update(value) {
    this.baseline = this.baseline == null ? value : Math.max(value, this.baseline * 0.98);
    const closedAt = this.baseline * 0.72, openAt = this.baseline * 0.88;
    if (!this.closed && value < closedAt) this.closed = true;
    else if (this.closed && value > openAt) { this.closed = false; this.blinked = true; }
    return this.blinked;
  }
}

export function buildMatcher(employees, threshold) {
  const labeled = employees
    .filter((e) => Array.isArray(e.face_descriptors) && e.face_descriptors.length)
    .map((e) => new faceapi.LabeledFaceDescriptors(e.id, e.face_descriptors.map((d) => new Float32Array(d))));
  return labeled.length ? new faceapi.FaceMatcher(labeled, threshold) : null;
}

export const toArray = (descriptor) => Array.from(descriptor, (v) => Math.round(v * 1e5) / 1e5);

export { faceapi };
