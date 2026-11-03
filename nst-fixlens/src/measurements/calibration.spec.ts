import { describe, it, expect } from 'vitest';
import {
  calibrate,
  calibratedArea,
  project,
  type CalibrationInput,
} from './calibration.js';
const reference: CalibrationInput = {
  method: 'reference_card',
  points: [
    { x: 20, y: 20 },
    { x: 120, y: 20 },
    { x: 120, y: 70 },
    { x: 20, y: 70 },
  ],
  width_mm: 100,
  height_mm: 50,
};
describe('planar calibration', () => {
  it('calibrates a measured rectangle without assuming standard card dimensions', () => {
    const c = calibrate(
      {
        ...reference,
        method: 'known_rectangle',
        width_mm: 300,
        height_mm: 150,
      },
      200,
      100,
    );
    const mask = new Uint8Array(20000);
    for (let y = 20; y < 70; y++)
      for (let x = 20; x < 120; x++) mask[y * 200 + x] = 1;
    expect(c.method).toBe('known_rectangle');
    expect(calibratedArea(mask, 200, 100, c)).toBeCloseTo(45000);
    expect(project(c.image_to_plane, 120, 70)).toEqual({ x: 300, y: 150 });
  });
  it('maps reference corners to millimeters and integrates a known area', () => {
    const c = calibrate(reference, 200, 100);
    expect(project(c.image_to_plane, 20, 20).x).toBeCloseTo(0);
    expect(project(c.image_to_plane, 20, 20).y).toBeCloseTo(0);
    expect(project(c.image_to_plane, 120, 70).x).toBeCloseTo(100);
    const mask = new Uint8Array(200 * 100);
    for (let y = 20; y < 70; y++)
      for (let x = 20; x < 120; x++) mask[y * 200 + x] = 1;
    expect(calibratedArea(mask, 200, 100, c)).toBeCloseTo(5000);
  });
  it('corrects perspective rather than using one pixel scale', () => {
    const c = calibrate(
      {
        ...reference,
        points: [
          { x: 30, y: 20 },
          { x: 130, y: 20 },
          { x: 150, y: 80 },
          { x: 10, y: 80 },
        ],
      },
      200,
      100,
    );
    expect(project(c.image_to_plane, 150, 80).x).toBeCloseTo(100);
    expect(project(c.image_to_plane, 150, 80).y).toBeCloseTo(50);
    const top = new Uint8Array(20000),
      bottom = new Uint8Array(20000);
    top[30 * 200 + 60] = 1;
    bottom[70 * 200 + 60] = 1;
    expect(calibratedArea(top, 200, 100, c)).toBeGreaterThan(
      calibratedArea(bottom, 200, 100, c),
    );
  });
  it.each([
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ],
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 0 },
      { x: 0, y: 100 },
    ],
    [
      { x: -1, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  ])(
    'rejects crossed, tiny, collinear or off-image references',
    (...points) => {
      expect(() => calibrate({ ...reference, points }, 200, 100)).toThrow();
    },
  );
});
