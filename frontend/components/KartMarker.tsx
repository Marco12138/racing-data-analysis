/** Plan-view symbol, sized for legibility, not a calibrated vehicle footprint. */
export function KartMarker({x,y,heading,color,outline,size=1}: {
  x:number; y:number; heading:number|null; color:string; outline:boolean; size?:number;
}) {
  return <g transform={`translate(${x} ${y}) rotate(${heading??0}) scale(${size})`} stroke={color} strokeLinejoin="round">
    {heading===null ? <circle r={outline?6:4} fill={outline?"none":color}/> :
      <g data-testid="kart-glyph" fill={outline?"none":"#17262a"} strokeWidth={outline?1.35:1.05}>
        <path d="M-12 -4 V4 M8 -5 V5 M-10 -3 L-5 -5 L5 -3 L11 -2 L11 2 L5 3 L-5 5 L-10 3Z"/>
        <path d="M5 -2 L11 -3 L14 -2 V2 L11 3 L5 2Z" fill={outline?"none":color}/>
        <path d="M-7 -7 H2 L3 -5 H-7Z M-7 7 H2 L3 5 H-7Z M-14 -5 V5"/>
        <rect x="-6" y="-2.6" width="5.5" height="5.2" rx="1.4"/><ellipse cx="2.2" cy="0" rx="1.2" ry="2.4"/>
        {[-11,6].flatMap(ax=>[-8,4].map(ay=><rect key={ax+":"+ay} x={ax} y={ay} width={ax<0?6:4.5} height="4" rx=".8" fill={outline?"none":color}/>))}
      </g>}
  </g>;
}
