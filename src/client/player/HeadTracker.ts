/**
 * Webcam head tracking for dodge movement + parallax.
 * Uses MediaPipe Face Landmarker to track the player's head position.
 * Head movement translates to actual character dodge (sent to server)
 * plus parallax camera offset (Johnny Lee-style window effect).
 */

import * as THREE from 'three';
import { FEATURES } from '@shared/constants.js';
import { send } from './network.js';
import type { GameRenderer } from './game/GameRenderer.js';

interface FaceData {
  x: number;
  y: number;
  width: number;
}

const SMOOTHING = 0.2;
const PARALLAX_SCALE_X = 1.5;
const PARALLAX_SCALE_Y = 0.8;
const PARALLAX_SCALE_Z = 0.8;
const DODGE_SCALE_X = 0.15;
const DODGE_SCALE_Z = 0.08;
const DODGE_SEND_RATE = 20; // Hz

export class HeadTracker {
  private renderer: GameRenderer;
  private video: HTMLVideoElement | null = null;
  private faceLandmarker: any = null;
  private baseline: FaceData | null = null;
  private smoothed: FaceData | null = null;
  private running = false;
  private lastDodgeSend = 0;
  private prevDx = 0;
  private prevDz = 0;

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
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      this.running = true;
      this.trackLoop();
      console.log('[head-tracking] Started');
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

      if (this.smoothed) {
        this.smoothed = {
          x: this.smoothed.x + (face.x - this.smoothed.x) * SMOOTHING,
          y: this.smoothed.y + (face.y - this.smoothed.y) * SMOOTHING,
          width: this.smoothed.width + (face.width - this.smoothed.width) * SMOOTHING,
        };
      } else {
        this.smoothed = { ...face };
      }

      if (!this.baseline) {
        this.baseline = { ...this.smoothed };
        console.log('[head-tracking] Calibrated baseline');
      }

      const dx = -(this.smoothed.x - this.baseline.x);
      const dy = this.smoothed.y - this.baseline.y;
      const dz = (this.baseline.width - this.smoothed.width) / this.baseline.width;

      // Parallax (visual only)
      this.renderer.setHeadOffset(new THREE.Vector3(
        dx * PARALLAX_SCALE_X,
        -dy * PARALLAX_SCALE_Y,
        dz * PARALLAX_SCALE_Z,
      ));

      // Dodge movement (sent to server to actually move the character)
      const now = performance.now();
      if (now - this.lastDodgeSend > 1000 / DODGE_SEND_RATE) {
        const dodgeDx = dx * DODGE_SCALE_X;
        const dodgeDz = dz * DODGE_SCALE_Z;
        if (Math.abs(dodgeDx - this.prevDx) > 0.001 || Math.abs(dodgeDz - this.prevDz) > 0.001) {
          send({ type: 'headDodge', dx: dodgeDx, dz: dodgeDz });
          this.prevDx = dodgeDx;
          this.prevDz = dodgeDz;
        }
        this.lastDodgeSend = now;
      }
    }

    requestAnimationFrame(() => this.trackLoop());
  }
}
