function verify_kr2_cowl_grip(out)
if nargin<1,out=tempdir;end
old=rng;restore=onCleanup(@()rng(old));rng(42);
P=[66 54;131 78;177 116];I=randi([0 255],168,234,3,'uint8');J=circshift(I,[4 -7 0]);
q=kr2_cowl_pair(I,J,P);assert(q.status=="local_image_match" && q.held<1e-8 && q.gain==1 && q.offset==-7+4i);
x=P(3,1)-7;y=P(3,2)+4;w=-10:10;
t=J(y+w,x+w,:);J(y+w,x+w,:)=0;J(y+8+w,x+w,:)=t;
q=kr2_cowl_pair(I,J,P);assert(q.status=="third_patch_mismatch" && q.held>=7 && isnan(q.gain));
q=kr2_cowl_pair(I*0,I*0,P);assert(q.status=="patch_unverified" && isnan(q.gain));
q=kr2_cowl_pair(I,I,[2 2;P(2:3,:)]);assert(q.status=="patch_unverified");
s=kr2_gallery_grip();mesh=kr2_gallery_grip_mesh(s);R=makehgtform('xrotate',.42,'zrotate',-.24);
uv=(s.bolts-s.hub)*R(1:3,1:2)*.8+[232 189];h=kr2_grip_projection(s,mesh,uv,1:3);
assert(max(abs(h.bolts-uv),[],'all')<1e-7 && norm(h.matrix'*h.matrix-h.scale^2*eye(2))<1e-8);
h2=kr2_grip_projection(s,mesh,uv+[7 18],1:3);assert(isequal(h.x+7,h2.x) && max(abs(h2.y-h.y-18))<1e-7);
[~,m]=kr2_public_gates();assert(m.anchor==159.55 && m.range==.5 && ~m.wholeRecordingVerified);
[f,go,T]=kr2_cowl_review();cl=onCleanup(@()delete(f(isgraphics(f))));good=T.status=="local_image_match";
assert(isequal(T.gate(good),[6;10;12;14]) && all(isnan(T.relative_image_deg(~good))));
for k=[10 9 1 14],go(k);assert(numel(findobj(f,'Tag','registeredSpokes'))==good(k));end
go(10);drawnow;writetable(T,fullfile(out,'kr2_cowl_pair_checks.csv'));
clear cl
[f2,go2,V]=demo_kr2_video_grip();cl2=onCleanup(@()delete(f2(isgraphics(f2))));
assert(nnz(V.fit)==1 && all(isnan(V.shaft_angle_deg)) && all(isfinite(V.flat_rms_px)));
assert(max(abs(sqrt(mean((V.predicted_upper_y-V.picked_upper_y).^2,2))-V.upper_rms_px))<1e-8);
for i=1:4,go2(i);assert(isscalar(findobj(f2,'Tag','checkedUpperSpan')) && findobj(f2,'Tag','videoGripChoice').Value==i);end
drawnow;writetable(V,fullfile(out,'kr2_grip_video_checks.csv'));
disp(V(:,{'lap','gate','fit','upper_rms_px','flat_rms_px','mean_signed_px'}));
fprintf('PASS: patch translation, independent rejection, flat and edge inputs, mesh camera, four real frame switches, anchor and withheld overlays.\n');
end
