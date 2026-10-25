/**
 * Debug fake controller: keyboard + mouse drives a sword for testing without a phone.
 * Sends input through the WebSocket as FakeInput messages.
 *
 * Mouse drag = sword orientation, Space = block, E = power
 */

import type { OrientationMsg, ButtonMsg } from '@shared/protocol.js';
import { send } from './network.js';

export class FakeController {
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private interval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    this.interval = setInterval(() => this.sendOrientation(), 1000 / 60);
  }

  stop(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    if (this.interval) clearInterval(this.interval);
  }

  private sendOrientation(): void {
    const cy = Math.cos(this.yaw / 2), sy = Math.sin(this.yaw / 2);
    const cp = Math.cos(this.pitch / 2), sp = Math.sin(this.pitch / 2);

    const q: [number, number, number, number] = [
      cy * sp,
      sy * cp,
      -sy * sp,
      cy * cp,
    ];

    // No real gyro here; the server falls back to blade-position speed
    const msg: OrientationMsg = {
      type: 'orientation',
      q,
      rotRate: [0, 0, 0],
      t: performance.now(),
    };
    send({ type: 'fakeInput', msg });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    let btn: ButtonMsg | null = null;
    if (e.key === ' ') btn = { type: 'button', button: 'block', state: 'down' };
    if (e.key === 'e' || e.key === 'E') btn = { type: 'button', button: 'power', state: 'down' };
    if (btn) send({ type: 'fakeInput', msg: btn });
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    let btn: ButtonMsg | null = null;
    if (e.key === ' ') btn = { type: 'button', button: 'block', state: 'up' };
    if (e.key === 'e' || e.key === 'E') btn = { type: 'button', button: 'power', state: 'up' };
    if (btn) send({ type: 'fakeInput', msg: btn });
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.target instanceof HTMLButtonElement) return;
    this.dragging = true;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    this.yaw -= e.movementX * 0.005;
    this.pitch -= e.movementY * 0.005;
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
  };

  private onMouseUp = (): void => {
    this.dragging = false;
  };
}
