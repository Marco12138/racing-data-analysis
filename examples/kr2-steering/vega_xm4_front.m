function [s,xyz]=vega_xm4_front(c,d,a)
% Manufacturer 047-TP-01 p.3. Reference meridian; not a loaded/rolling tyre model.
% Zero-based coordinates on page 3 rendered with pdftoppm -scale-to 1050.
u=[262 243 227 204 184 166];v=[531.5 531.5 530.5 529 526.5 524];
R=130;r0=63.1;
crownW=(262-u)*55/(262-166);crownR=r0+(v-387)*(R-r0)/(531.5-387);
sideV=[387 407 439 460 479 496 513 524];
sideW=[60 61 64.2 65 64.3 62 58.5 55];
sideR=r0+(sideV-387)*(R-r0)/(531.5-387);
w=[sideW fliplr(crownW(1:end-1))];r=[sideR fliplr(crownR(1:end-1))];
q=linspace(1,numel(w),1+8*(numel(w)-1));w=pchip(1:numel(w),w,q)';r=pchip(1:numel(r),r,q)';
s=struct('model',"Vega XM4 CIK Prime",'fiche',"047-TP-01",'ABCDE_mm',[130 110 120 260 126.2],...
    'widthToleranceMM',5,'diameterToleranceMM',5,'halfWidth',w,'radial',r,...
    'rollingRadiusMM',NaN,'wheelLoadN',NaN);
if nargout<2,return,end
xyz=wheel_surface(c,d,a,[w;-flipud(w(1:end-1))],[r;flipud(r(1:end-1))]);
end
