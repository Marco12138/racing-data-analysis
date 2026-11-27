function [C,t,len]=kr2_gallery_grip_mesh(s)
% Neutral grip in front-axle coordinates. Same material ring in the car and video trial.
P=s.grip;N=size(P,1);len=[0;cumsum(vecnorm(diff([P;P(1,:)]),2,2))];
t=linspace(0,len(end),225)';tt=[len(N)-len(end);len;len(end)+len(2)];
Q=pchip(tt,[P(end,:);P;P(1:2,:)]',t)';tangent=circshift(Q(1:end-1,:),-1)-circshift(Q(1:end-1,:),1);
tangent=[tangent;tangent(1,:)];rad=cross(tangent,repmat(s.normal,size(Q,1),1),2);rad=rad./vecnorm(rad,2,2);
q=linspace(0,2*pi,25);C=zeros(numel(t),numel(q),3);
for i=1:numel(q),C(:,i,:)=reshape(Q+13*(cos(q(i))*rad+sin(q(i))*s.normal),[],1,3);end
end
