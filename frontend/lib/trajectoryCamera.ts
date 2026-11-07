type XY = { local_x_m:number; local_y_m:number };
export const SCHEMATIC_ROAD_WIDTH_M = 8;
export const SCHEMATIC_OUTER_WIDTH_M = SCHEMATIC_ROAD_WIDTH_M + .4;
export const PLOT_WIDTH = 600, PLOT_HEIGHT = 310;
export type Camera = { x:number; y:number; scale:number; angle:number };
export function fitCamera(points: XY[], full = false): Camera {
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for (const p of points) {
    xmin=Math.min(xmin,p.local_x_m); xmax=Math.max(xmax,p.local_x_m);
    ymin=Math.min(ymin,p.local_y_m); ymax=Math.max(ymax,p.local_y_m);
  }
  // Fit the whole schematic ribbon (including its edges), not just its centre.
  const dx=xmax-xmin+SCHEMATIC_OUTER_WIDTH_M, dy=ymax-ymin+SCHEMATIC_OUTER_WIDTH_M, rotate=full && dy>dx;
  return {x:(xmin+xmax)/2,y:(ymin+ymax)/2,angle:rotate ? -90 : 0,
    scale:Math.min((PLOT_WIDTH-72)/(rotate?dy:dx),(PLOT_HEIGHT-72)/(rotate?dx:dy))};
}
export function blendCamera(a:Camera,b:Camera,u:number): Camera {
  const t=u*u*(3-2*u);
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,scale:a.scale*(b.scale/a.scale)**t,angle:a.angle+(b.angle-a.angle)*t};
}
export function screenPoint(camera:Camera,p:XY) {
  const rad=camera.angle*Math.PI/180, c=Math.cos(rad), s=Math.sin(rad);
  const x=(p.local_x_m-camera.x)*camera.scale,y=(camera.y-p.local_y_m)*camera.scale;
  return {x:PLOT_WIDTH/2+c*x-s*y,y:PLOT_HEIGHT/2+s*x+c*y};
}
