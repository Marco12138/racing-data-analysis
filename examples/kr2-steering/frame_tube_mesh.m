function [X,Y,Z]=frame_tube_mesh(P,r)
% Keep the original horizontal seam for ordinary rails; vertical sections need a different normal.
T=diff(P);len=vecnorm(T,2,2);assert(all(isfinite(len)&len>0),'kart:TubePath','Repeated or invalid tube station.');
T=T./len;T=[T(1,:);T(1:end-1,:)+T(2:end,:);T(end,:)];
assert(all(vecnorm(T,2,2)>1e-10),'kart:TubePath','A reversing centreline has no defined tangent.');
T=T./vecnorm(T,2,2); N=cross(T,repmat([0 0 1],size(T,1),1),2);
vertical=vecnorm(N,2,2)<1e-8;
for i=find(vertical)'
    if i>1,v=N(i-1,:);else,j=find(~vertical,1);if isempty(j),v=[1 0 0];else,v=N(j,:);end;end
    N(i,:)=v-dot(v,T(i,:))*T(i,:);
end
N=N./vecnorm(N,2,2); B=cross(T,N,2); t=linspace(0,2*pi,25);
C=cell(1,3);
for j=1:3, C{j}=P(:,j)+r*(N(:,j)*cos(t)+B(:,j)*sin(t)); end
[X,Y,Z]=deal(C{:});
end
