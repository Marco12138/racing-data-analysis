function s=kr2_gallery_grip(photoDir,alt)
% KR catalogue half-size zero-based coordinates. View 3 is evaluation only.
if nargin<1,photoDir='';end
if nargin<2,alt=false;end
s=kr2_catalogue_rims(alt);C=s.camera;
s.bandUV={[537.51 84.91;556.90 168.78],[450.38 146.62],[396.20 127.05;498.20 124.03]};
windows={[530 76 547 98;543 157 570 182],[439 133 463 161],[389 112 410 142;484 109 510 140]};
if ~isempty(photoDir)
    for k=1:3
        a=imread(fullfile(photoDir,s.images{k}));assert(isequal(size(a),[1200 1800 3]));
        for j=1:size(windows{k},1)
            box=windows{k}(j,:)*2;I=double(a(box(2)+1:box(4),box(1)+1:box(3),:));
            R=I(:,:,1);G=I(:,:,2);B=I(:,:,3);[v,u]=find(R>95 & R-G>40 & R-B>60 & G<177);
            assert(numel(u)>200 && all(u>1 & u<size(I,2) & v>1 & v<size(I,1)),'Orange band is missing or clipped.');
            s.bandUV{k}(j,:)=([mean(u) mean(v)]-1+box(1:2))/2;
        end
    end
end
% Grip centreline in the first oblique view, not the silhouette of the tyre or steering spokes.
P=[181 68;205 74;223 90;235 113;238 139;235 166;226 197;213 233;...
    204 248;191 270;177 290;154 310;130 325;103 336;80 339;65 334;...
    59 319;53 285;49 256;49 225;53 199;64 169;75 148;90 128;108 106;128 89;153 76;174 68];
P=P/2+[450 52];s.trace1=P;
% Fit a symmetric pair in space; near side is driver right in view 1, left in view 2.
mirror=[1 -1 1];opt=optimset('Display','off','TolX',1e-7,'TolFun',1e-10);
band=fminsearch(@(v)sum(bandError(v).^2,'all'),[-300 110 350],opt);
s.bands=[band;band.*mirror];s.bandFitError=bandError(band);
joints=[408.5 111;489 190.5];s.ends2=joints;
axisUV=diff(joints);axisUV=axisUV/norm(axisUV);ends=joints*axisUV';
% Only along-strip extrema in the edge-on second photo: hidden spokes and its
% hidden second seam do not become observations.
angles=5:.5:85;loss=arrayfun(@cost,angles);[~,k]=min(loss);
assert(k>1 && k<numel(angles),'Grip pitch is not bounded by these views.');
s.pitch=fminbnd(@cost,angles(k-1),angles(k+1));s.pitchCost=[angles(:) loss(:)];
s.grip=unproject(P,s.pitch,band);s.endErrors=extrema(s.grip)-ends;
% The 3 metal fasteners are on the spoke plate. Their depth relative to the
% grip plane is unknown; zero dish is ONE assembly scenario.
bolts=[512.2 150.2;526.6 149.2;515.6 166];s.boltUV=bolts;
s.bolts=unproject(bolts,s.pitch,band);s.hub=mean(s.bolts,1);
s.normal=[-sind(s.pitch) 0 cosd(s.pitch)];s.fore=[cosd(s.pitch) 0 sind(s.pitch)];
s.span=max(s.grip(:,2))-min(s.grip(:,2));s.spokeEnds=[22 1 8 15];
% Visible centre of the labelled grip between the seams in the unused front view.
v=[626 99;640 91;665 85;694 80;721 79;748 80;775 81;805 86;829 94];
s.trace3=v/2+[82.5 77];s.bandHold=vecnorm(kr2_catalogue_project(C(3),flipud(s.bands))-s.bandUV{3},2,2);
g=kr2_front_scenario();w=kr2_handwheel();M=kr2_handwheel_mount(g,[0 0 0]);
uv=(w.outer+w.inner)/2;s.old=[uv zeros(size(uv,1),1)]*M(1:3,1:3)'+M(1:3,4)';
s.heldOld=distanceToPath(s.trace3,kr2_catalogue_project(C(3),s.old)); % optimistic: any old rim section
s.heldNew=distanceToPath(s.trace3,kr2_catalogue_project(C(3),s.grip(1:8,:))); % labelled grip only
s.shaft=s.hub-g.column;s.length=norm(s.shaft);s.shaft=s.shaft/s.length;
s.hubOffOldAxis=norm(cross(s.hub-g.column,g.columnAxis));
s.hubInclination=acosd(max(-1,min(1,dot(s.normal,s.shaft))));
s.dishMM=[-15;0;15];s.dishHubs=zeros(3,3);
for i=1:3,s.dishHubs(i,:)=mean(unproject(bolts,s.pitch,band+s.dishMM(i)*s.normal));end
% A separate, hand-read silver collar below the upper black hub in photo 2.
% It does not set the camera, grip plane, bolt depth or lower pivot.
s.collarUV=[429 176.5];e=[-2 -2;-2 2;2 -2;2 2];
s.collarShaftTips=[M(1:3,4)';s.dishHubs];s.collarCheck=zeros(4,4);
for i=1:4
    lineUV=kr2_catalogue_project(C(2),[g.column;s.collarShaftTips(i,:)]);
    v=diff(lineUV);u=v/norm(v);n=[-u(2);u(1)];w=s.collarUV-lineUV(1,:);
    signed=(w+e)*n;lo=min(signed);hi=max(signed);
    s.collarCheck(i,:)=[abs(w*n) max([0 lo -hi]) max(abs(signed)) w*v'/dot(v,v)];
end
s.wuhanValidated=false;s.photographedAngleKnown=false;
    function e=bandError(v)
        e=[kr2_catalogue_project(C(1),[v;v.*mirror])-s.bandUV{1};kr2_catalogue_project(C(2),v)-s.bandUV{2}];
    end
    function X=unproject(uv,a,b)
        n=[-sind(a) 0 cosd(a)];c=C(1);o=-c.t*c.R;
        ray=[(uv-c.centre)/c.f ones(size(uv,1),1)]*c.R;
        X=o+ray.*(dot(b-o,n)./(ray*n'));
    end
    function e=extrema(X)
        v=kr2_catalogue_project(C(2),X)*axisUV';e=[min(v);max(v)];
    end
    function y=cost(a)
        y=sum((extrema(unproject(P,a,band))-ends).^2);
    end
end
function d=distanceToPath(uv,V)
A=V(1:end-1,:);D=diff(V);den=sum(D.^2,2);keep=den>1e-12;D=D(keep,:);A=A(keep,:);den=den(keep);
d=zeros(size(uv,1),1);for i=1:numel(d)
    t=min(1,max(0,sum((uv(i,:)-A).*D,2)./den));
    d(i)=min(vecnorm(uv(i,:)-A-D.*t,2,2));
end
end
