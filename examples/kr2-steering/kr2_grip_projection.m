function h=kr2_grip_projection(s,mesh,uv,order)
% One possible scaled orthographic camera. Three *planar* points fit exactly
% by construction; neither this fit nor the unknown normal gives a shaft angle.
E=[s.fore;0 1 0;s.normal];B=(s.bolts(order,:)-s.hub)*E';assert(max(abs(B(:,3)))<1e-6);
p=mean(uv,1);A=B(:,1:2)\(uv-p);[~,S,V]=svd(A);
D=[A;sqrt(max(0,S(1,1)^2-S(2,2)^2))*V(:,2)'];h.matrix=E'*D;h.scale=S(1,1);
h.bolts=B*D+p;
U=(reshape(mesh,[],3)-s.hub)*h.matrix+p;sz=size(mesh);ix=reshape(1:size(U,1),sz(1:2));
start=[reshape(ix(1:end-1,:),[],1);reshape(ix(:,1:end-1),[],1)];
finish=[reshape(ix(2:end,:),[],1);reshape(ix(:,2:end),[],1)];
l=U(start,1);r=U(finish,1);h.x=(ceil(min(U(:,1))):floor(max(U(:,1))))';h.y=nan(size(h.x));
for k=1:numel(h.x)
    x=h.x(k);ok=x>=min(l,r) & x<=max(l,r) & abs(r-l)>1e-9;
    if any(ok),h.y(k)=min(U(start(ok),2)+(x-l(ok))./(r(ok)-l(ok)).*(U(finish(ok),2)-U(start(ok),2)));end
end
end
