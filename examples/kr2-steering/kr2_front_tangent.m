function g=kr2_front_tangent(png)
% Archived FIA photo, zero-based UV. Positive model X forward, Y driver left.
% Extracted image orientation differs from the rendered page. See kr2_fiche_xy.
u={315:3:339,145:3:166};
v={[401.827 401.521 401.022 400.861 400.576 400.230 399.839 399.522 399.216],...
   [398.928 399.078 399.368 399.774 400.136 400.549 400.833 401.071]};
if nargin
    [im,map]=imread(png);
    if ~isempty(map),im=uint8(round(255*ind2rgb(im,map)));end
    if size(im,3)>1,im=im(:,:,1);end
    assert(isa(im,'uint8') && isequal(size(im),[551 491]),'Unexpected archival photo.');
    rows=(394:408)';
    for j=1:2
        w=max(248-double(im(rows+1,u{j}+1)),0);
        assert(all(sum(w)>0) && all(im(394,u{j}+1)>248) && all(im(410,u{j}+1)>248),'Rod not isolated.');
        read=sum(rows.*w)./sum(w);
        assert(max(abs(read-v{j}))<.001,'Unexpected registered pixels.');
        v{j}=read;
    end
end
g.scale=[1050/(433-89.5),638/(346-140.5)]; % longitudinal / transverse mm per pixel
xy=@(uv) kr2_fiche_xy(uv,'photo');
u=u([2 1]);v=v([2 1]); % published driver left, then driver right
outerUV=[133.25 397.3;352.3 397.5];
g.pin=xy([132.6 433.1;352.3 433.5]);g.outer=xy(outerUV);
g.J=zeros(2);g.lever=zeros(2,1);g.holdPx=g.lever;g.outerMissPx=g.lever;
for j=1:2
    train=mod(1:numel(u{j}),2)==1; fit=polyfit(u{j}(train),v{j}(train),1);
    g.holdPx(j)=max(abs(polyval(fit,u{j}(~train))-v{j}(~train)));
    g.outerMissPx(j)=abs(polyval(fit,outerUV(j,1))-outerUV(j,2));
    ends=[min(u{j});max(u{j})];g.segment{j}=xy([ends polyval(fit,ends)]);
    n=diff(g.segment{j});n=n/norm(n);if sign(n(2))~=sign(g.pin(j,2)),n=-n;end
    r=g.outer(j,:)-g.pin(j,:);d=r(1)*n(2)-r(2)*n(1);
    g.n(j,:)=n;g.lever(j)=abs(d);g.J(j,:)=rad2deg(n/d);
end
end
