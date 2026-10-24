/**
 * Webcam head tracking for first-person parallax.
 * Uses MediaPipe Face Landmarker to track the player's head position.
 * Maps head offset to camera parallax (Johnny Lee-style window effect).
 *
 * In the two-laptop setup, each laptop tracks only its own player's face.
 * The single face detected drives the parallax for that player's view.
 */

import * as THREE from 'three';
import { FEATURES } from '@shared/constants.js';
import type { GameRenderer } from './game/GameRenderer.js';

interface FaceData {
  x: number;   // normalized 0-1
  y: number;
  width: number; // face width for depth
}

const SMOOTHING = 0.15;
const PARALLAX_SCALE_X = 1.0;
const PARALLAX_SCALE_Y = 0.5;
const PARALLAX_SCALE_Z = 0.5; // depth from face size

export class HeadTracker {
  private renderer: GameRenderer;
  private video: HTMLVideoElement | null = null;
  private faceLandmarker: any = null;
  private baseline: FaceData | null = null;
  private smoothed: FaceData | null = null;
  private running = false;

  constructor(renderer: GameRenderer) {
    this.renderer = renderer;
  }

  async start(): Promise<void> {
    if (!FEATURES.HEAD_TRACKING) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });

      this.video = document.createElement('video');
      this.video.srcObject = stream;
      this.video.autoplay = true;
      this.video.playsInline = true;
      await this.video.play();

      const vision = await import('@mediapipe/tasks-vision');
      const { FaceLandmarker, FilesetResolver } = vision;

      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
      );

      this.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1, // only need our own face
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      this.running = true;
      this.trackLoop();
      console.log('[head-tracking] Started (single-player first-person mode)');
    } catch (e) {
      console.log('[head-tracking] Not available:', e);
      throw e;
    }
  }

  stop(): void {
    this.running = false;
    if (this.video?.srcObject) {
      (this.video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
  }

  private trackLoop(): void {
    if (!this.running || !this.video || !this.faceLandmarker) return;

    const results = this.faceLandmarker.detectForVideo(this.video, performance.now());

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];
      const nose = landmarks[1];
      const leftEye = landmarks[33];
      const rightEye = landmarks[263];
      const faceWidth = Math.abs(rightEye.x - leftEye.x);

      const face: FaceData = { x: nose.x, y: nose.y, width: faceWidth };

      // Smooth
      if (this.smoothed) {
        this.smoothed = {
          x: this.smoothed.x + (face.x - this.smoothed.x) * SMOOTHING,
          y: this.smoothed.y + (face.y - this.smoothed.y) * SMOOTHING,
          width: this.smoothed.width + (face.width - this.smoothed.width) * SMOOTHING,
        };
      } else {
        this.smoothed = { ...face };
      }

      // Auto-calibrate on first detection
      if (!this.baseline) {
        this.baseline = { ...this.smoothed };
        console.log('[head-tracking] Calibrated baseline');
      }

      // Compute offset from baseline → parallax
      const dx = -(this.smoothed.x - this.baseline.x); // mirror-corrected
      const dy = this.smoothed.y - this.baseline.y;
      const dz = (this.baseline.width - this.smoothed.width) / this.baseline.width;

      this.renderer.setHeadOffset(new THREE.Vector3(
        dx * PARALLAX_SCALE_X,
        -dy * PARALLAX_SCALE_Y,
        dz * PARALLAX_SCALE_Z,
      ));
    }

    requestAnimationFrame(() => this.trackLoop());
  }
}
