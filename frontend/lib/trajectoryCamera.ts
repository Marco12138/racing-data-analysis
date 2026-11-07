import { createTrackProjection } from "./driverComparison";
type XY = { local_x_m:number; local_y_m:number };
export type Camera = { x:number; y:number; scale:number };
export function fitCamera(points: XY[]): Camera {
  const fit=createTrackProjection(points,600,234,36)!;
  const zero=fit.project({local_x_m:0,local_y_m:0});
  return {x:(300-zero.x)/fit.scale,y:(zero.y-117)/fit.scale,scale:fit.scale};
}
export function blendCamera(a:Camera,b:Camera,u:number): Camera {
  const t=u*u*(3-2*u);
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,scale:a.scale*(b.scale/a.scale)**t};
}
export function screenPoint(camera:Camera,p:XY) {
  return {x:300+(p.local_x_m-camera.x)*camera.scale,y:117-(p.local_y_m-camera.y)*camera.scale};
}
