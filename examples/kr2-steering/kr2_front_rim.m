function m=kr2_front_rim(photo,level)
% Zero-based native coordinates in FIA 023-CH-98 p.1. Measure flange
% crests, not outside silhouette extrema (which include a view of rim depth).
top=[47.5 88.5 396.5 436.5];bottom=[44.5 86 397.5 438.5];
diam=[41 40 38 38 32 27 27 30 32 35 37 38 38 39 37 40 41;
      42 39 39 36 33 27 26 32 34 35 36 38 38 38 38 40 42]';
f=(0:16)'/16;
if nargin
    if nargin<2,level=175;end
    [I,map]=imread(photo);if ~isempty(map),I=uint8(round(ind2rgb(I,map)*255));end
    I=mean(double(I),3);assert(isequal(size(I),[551 491]),'Expected native page-1 chassis photograph.');
    rows=401:462;mask=I(rows+1,:)<level;win=[41 50;83 91;393 402;433 442];
    for i=1:4
        u=win(i,1):win(i,2);u=u(any(mask(:,u+1),1));assert(~isempty(u),'Missing rim edge.');
        [~,a]=max(mask(:,u+1),[],1);[~,b]=max(flipud(mask(:,u+1)),[],1);
        top(i)=median(u(a==min(a)));bottom(i)=median(u(b==min(b)));
    end
    lip=(top+bottom)/2;
    for j=1:2
        if j==1,ends=lip([2 1]);else,ends=lip([3 4]);end
        u=round(ends(1)+f*diff(ends));
        for k=1:numel(u)
            v=rows(mask(:,u(k)+1));assert(~isempty(v),'Missing rim silhouette.');diam(k,j)=v(end)-v(1);
        end
    end
end
lip=(top+bottom)/2;xy=kr2_fiche_xy([lip' 433*ones(4,1)],'photo');
pin=kr2_front_tangent();m.observedCentreY=[mean(xy(1:2,2));mean(xy(3:4,2))];
m.observedLever=abs(m.observedCentreY-pin.pin(:,2));m.width=abs(diff(xy(1:2,2)));
m.top=top;m.bottom=bottom;m.diamPx=diam;m.rimToPin=m.observedLever(1);
m.heldCentreError=m.rimToPin-m.observedLever(2);
% Only the driver's left wheel sets the geometry. Right wheel is held out.
m.axial=(f-.5)*m.width;m.radius=diam(:,1)*pin.scale(1)/2;
m.holdWidth=m.width-abs(diff(xy(3:4,2)));m.holdProfileMM=diff(diam,1,2)*pin.scale(1)/2;
m.measuredOnWuhan=false;
end
