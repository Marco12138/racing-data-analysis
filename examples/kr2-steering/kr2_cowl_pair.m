function q=kr2_cowl_pair(left,right,points)
% Local, same-camera L4 -> L5 similarity. Third patch is never fitted.
assert(isequal(size(left),size(right)) && size(left,3)==3 && isequal(size(points),[3 2]));
gray=@(I)double(I(:,:,1))*.299+double(I(:,:,2))*.587+double(I(:,:,3))*.114;
L=gray(left);R=gray(right);
q=struct('status',"patch_unverified",'ref',points,'picked',nan(3,2),'scale',nan,...
    'roll',nan,'held',nan,'translationHeld',nan,'rawHeld',nan,'gain',nan,'offset',nan);
q.ncc=nan(3,1);q.margin=q.ncc;q.cycle=q.ncc;
for i=1:3
    [p,score,gap]=pick(L,R,points(i,:));
    q.ncc(i)=score;q.margin(i)=gap;if ~all(isfinite(p)),continue;end
    [back,b,margin]=pick(R,L,p);q.cycle(i)=norm(back-points(i,:));q.picked(i,:)=p;
    q.ncc(i)=min(score,b);q.margin(i)=min(gap,margin);
end
if any(~isfinite(q.cycle) | q.cycle>1.5 | q.ncc<.76 | q.margin<.04),return;end
z=complex(points(:,1),points(:,2));w=complex(q.picked(:,1),q.picked(:,2));
if abs(z(2)-z(1))<35,q.status="short_baseline";return;end
a=(w(2)-w(1))/(z(2)-z(1));b=w(1)-a*z(1);
q.scale=abs(a);q.roll=-rad2deg(angle(a));q.held=abs(a*z(3)+b-w(3));
q.translationHeld=abs(z(3)+mean(w(1:2)-z(1:2))-w(3));q.rawHeld=abs(w(3)-z(3));
if q.held>3,q.status="third_patch_mismatch";return;end
q.status="local_image_match";q.gain=a;q.offset=b;
end
function [p,score,gap]=pick(source,dest,at)
p=[nan nan];score=nan;gap=nan;r=10;at=round(at);
x=at(1);y=at(2);if x-r<1 || y-r<1 || x+r>size(source,2) || y+r>size(source,1),return;end
K=source(y-r:y+r,x-r:x+r);K=K-mean(K,'all');if std(K(:))<2,return;end
xx=max(1,x-40-r):min(size(dest,2),x+40+r);yy=max(1,y-23-r):min(size(dest,1),y+23+r);
W=dest(yy,xx);kernel=ones(size(K));A=conv2(W,kernel,'valid');
energy=max(0,conv2(W.^2,kernel,'valid')-A.^2/numel(K));
S=conv2(W,rot90(K,2),'valid')./(norm(K,'fro')*sqrt(max(eps,energy)));S(energy<4*numel(K))=-inf;
[score,k]=max(S,[],'all');[j,i]=ind2sub(size(S),k);
if ~isfinite(score) || any([i j]==1) || i==size(S,2) || j==size(S,1),return;end
[X,Y]=meshgrid(1:size(S,2),1:size(S,1));S(hypot(X-i,Y-j)<=6)=-inf;gap=score-max(S,[],'all');
p=[xx(1)+r+i-1 yy(1)+r+j-1];
end
