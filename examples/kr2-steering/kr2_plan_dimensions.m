function s=kr2_plan_dimensions(png)
% Zero-based witness lines, native 1004 x 511 drawing on fiche 023-CH-98 p.2.
p=[219.612000 834.290456 65.161765 501.364035 96.231818 470.221198];
outline=[435 435 436]; % dark outer bracket extents, three thresholds
if nargin
    [I,map]=imread(png);
    if ~isempty(map),I=uint8(round(255*ind2rgb(I,map)));end
    I=mean(double(I),3);assert(isequal(size(I),[511 1004]) && max(I,[],'all')==255);
    p=[pick(I',216:223,30:55),pick(I',831:837,30:55),...
       pick(I,61:68,91:179),pick(I,498:505,91:179),...
       pick(I,92:100,966:986),pick(I,466:474,966:986)];
    % Sample the bracket itself, not the lighter horizontal dimension leaders.
    levels=[35 55 75];u=209:218;
    for i=1:3
        upper=find(any(I((64:74)+1,u+1)<levels(i),2),1);
        lower=find(any(I((492:503)+1,u+1)<levels(i),2),1,'last');
        assert(~isempty(upper) && ~isempty(lower),'Bracket not visible.');
        outline(i)=492+lower-(64+upper);
    end
end
A=p(2)-p(1);E=p(4)-p(3);F=p(6)-p(5);
aspect=(245.299973/511)/(481.949860/1004); % original PDF placement, y pixel / x pixel
s.eNominal=728;s.eTolerance=10;s.witness=p;s.eFromA=E*1050*aspect/A;s.eFromF=E*638/F;
s.outlineFromA=outline*1050*aspect/A;
s.eSpanPx=E;s.fitAMMPerPx=1050/A;s.frontWidthVerified=false;
% Trace only the visible, overlapping lug edges in plan, not a solid or material thickness.
u=200:234;
edges=[83 80 79 77 75 73 71 70 69 68 67 66 66 66 65 65 65 65 66 66 66 67 67 68 69 71 72 72 72 73 73 74 75 77 79;...
       483 486 488 489 491 493 495 496 498 499 499 500 500 501 501 501 501 501 501 501 500 500 499 498 497 496 495 494 494 493 493 492 491 490 488];
if nargin
    for j=1:numel(u)
        r=find(I((64:92)+1,u(j)+1)<75,1);
        l=find(I((474:503)+1,u(j)+1)<75,1,'last');assert(~isempty(r) && ~isempty(l));
        edges(:,j)=[63+r;473+l];
    end
end
fit=1:2:numel(u);hold=2:2:numel(u);uq=linspace(u(1),u(end),137)';
yc=mean(p(5:6));s.holdPx=zeros(2,1);s.edgeXY=cell(2,1);
for j=1:2 % model order: driver left, driver right
    v=edges(3-j,:);s.holdPx(j)=max(abs(pchip(u(fit),v(fit),u(hold))-v(hold)));
    s.edgeXY{j}=[p(1)-uq,(pchip(u(fit),v(fit),uq)-yc)*aspect]*s.fitAMMPerPx;
end
% Per-endpoint perturbation +/-1 native pixel. Neither band is statistical.
ratios=[(E-2)/(A+2) (E+2)/(A-2)]*aspect;
s.pickOnly=1050*ratios;s.pickAndAxleLimits=[1040 1060].*ratios;
end
function p=pick(I,rows,columns)
w=255-I(rows+1,columns+1);
assert(all(sum(w,1)>0) && all(w([1 end],:)==0,'all'),'Clipped or absent witness line.');
p=median(sum(rows'.*w,1)./sum(w,1));
end
