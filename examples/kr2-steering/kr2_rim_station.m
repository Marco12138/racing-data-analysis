function s=kr2_rim_station(png)
% Archival flange crests, not tyre edges or the ends of the axle. Positive
% distances are obtained after the page-1 orientation correction.
top=[16.5 85 395.5 462.5];bottom=[18.5 86 392 460.5];
f=[0 .04 .09 .18 .34 .48 .56 .62 .70 .80 .86 .92 .96 1]';
diam=[45 45 41 41 39 39 33 30 30 29 36 42 41 46;44 44 42 40 39 37 36 30 29 28 34 41 42 44]';
if nargin
    [im,map]=imread(png);if ~isempty(map),im=uint8(round(255*ind2rgb(im,map)));end
    im=mean(double(im),3);assert(isequal(size(im),[551 491]) && max(im,[],'all')==255);
    limits=[10 26;78 92;386 405;453 468];mask=im(56:122,:)<185;
    for j=1:4
        u=limits(j,1):limits(j,2);col=mask(:,u+1);assert(all(any(col,1)));
        [~,t]=max(col,[],1);[~,b]=max(flipud(col),[],1);
        top(j)=median(u(t==min(t)));bottom(j)=median(u(b==min(b)));
    end
    for j=1:2
        inds=[1 2];if j==2,inds=[4 3];end
        u=round(top(inds(1))+f*diff(top(inds)));
        for k=1:numel(u)
            rows=find(mask(:,u(k)+1));diam(k,j)=rows(end)-rows(1)+1;
        end
    end
end
xy=kr2_fiche_xy([top' 89.5*ones(4,1)],'photo');yb=kr2_fiche_xy([bottom' 89.5*ones(4,1)],'photo');
middle=@(y) [mean(y(1:2));mean(y(3:4))];
s.rawCentresY=middle(xy(:,2));s.estimatedSpacing=-diff(s.rawCentresY);
s.heldSpacing=-diff(middle(yb(:,2)));s.lipWidth=abs([diff(xy(1:2,2)),diff(xy(3:4,2))]);
s.top=top;s.bottom=bottom;s.spanPx=diam;
s.f=unique([linspace(0,1,100) f'])';scaleX=1050/(433-89.5);
s.radius=pchip(f,diam(:,1)/2,s.f)*scaleX; % fit driver left; right only tests scale and shape
s.heldDiameterMaxMM=max(abs(diff(diam,1,2)))*scaleX;
s.verifiedOnSample=false;
end
