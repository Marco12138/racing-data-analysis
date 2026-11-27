function tubes=kr2_archive_rails()
% FIA 023-CH-98, page 2: digitized plan with approximate height from the side view.
points = {
    [249 500;293 543;309 560;324 570;341 574;423 574;437 571;451 563;490 525;507 509;520 503;534 502;860 502]
    [489 562;510 551;524 546;537 545;824 545]
    [249 786;293 742;310 724;325 717;340 715;423 715;437 718;451 726;490 764;507 780;520 786;534 787;860 787]
    [667 787;697 545]
    [489 525;489 764]
    [269 484;249 500;167 566;159 576;155 589;155 694;158 706;167 718;249 786;269 802]
};
mm=1050/491;zscale=590*mm/665;
sideX=([110 238 282 299 313 903]-238)*zscale;
sideZ=(1034-[1072 1038 1064 1076 1080.5 1080.5])*zscale;
tubes=cell(1,6);
for i=1:6
    p=points{i};s=[0;cumsum(vecnorm(diff(p),2,2))];
    q=pchip(s,p',unique([s;linspace(0,s(end),max(2,ceil(s(end)/3)))']))';
    x=(q(:,1)-270)*mm;z=interp1(sideX,sideZ,max(sideX(1),min(x,sideX(end))),'pchip');
    tubes{i}=[-x,(q(:,2)-644.5)*mm,z];
end
end
