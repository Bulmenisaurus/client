import { RGBVec } from '../Renderers/GameRenderer/EngineTypes';
import Color from 'color';

let hueIncrement = 0;

setInterval(() => {
  hueIncrement++;
}, 5);

export const getSilverColor = (seed = 0): RGBVec => {
  const hsvColor = Color.hsv((hueIncrement + seed) % 360, 90, 100);

  return [hsvColor.red(), hsvColor.green(), hsvColor.blue()] as RGBVec;
};
