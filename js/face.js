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

const opts = (inputSize) => new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 });

// descriptors=false skips the (slow) recognition step — used for fast blink/head tracking
export async function detectFaces(video, { descriptors = true, inputSize = 416 } = {}) {
  const q = faceapi.detectAllFaces(video, opts(inputSize)).withFaceLandmarks();
  return descriptors ? q.withFaceDescriptors() : q;
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

// Liveness: passes on a blink (open -> closed -> open) OR a small head turn.
// A printed photo can't blink, and turning it doesn't change where the nose sits inside the face.
export class LivenessDetector {
  constructor() { this.reset(); }
  reset() { this.baseline = null; this.closed = false; this.minTurn = Infinity; this.maxTurn = -Infinity; this.passed = false; this.how = ''; }
  update(landmarks, box) {
    if (this.passed) return true;
    // blink
    const v = eyeOpenness(landmarks);
    this.baseline = this.baseline == null ? v : Math.max(v, this.baseline * 0.99);
    if (!this.closed && v < this.baseline * 0.8) this.closed = true;
    else if (this.closed && v > this.baseline * 0.9) { this.passed = true; this.how = 'blink'; }
    // head turn: nose position inside the face box
    const nose = landmarks.getNose()[3];
    const t = (nose.x - box.x) / box.width;
    this.minTurn = Math.min(this.minTurn, t); this.maxTurn = Math.max(this.maxTurn, t);
    if (this.maxTurn - this.minTurn > 0.1) { this.passed = true; this.how = 'turn'; }
    return this.passed;
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
