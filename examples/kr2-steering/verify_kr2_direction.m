function verify_kr2_direction(out)
% No network, input files, private photos or toolbox-specific simulation.
if nargin<1,out=tempdir;end
if ~isfolder(out),mkdir(out);end
dims=kr2_plan_dimensions();
fprintf('FIA front bracket: labelled %.0f +/- %.0f mm; drawn %.1f mm using A or %.1f mm using F. Not a measured track width.\n',dims.eNominal,dims.eTolerance,dims.eFromA,dims.eFromF);
sets=["primary";"alternate"];old=zeros(2,1);new=old;seams=zeros(2,2);
for i=1:2
    s=kr2_gallery_grip('',i==2);old(i)=sqrt(mean(s.heldOld.^2));new(i)=sqrt(mean(s.heldNew.^2));seams(i,:)=s.bandHold;
    assert(new(i)<old(i) && ~s.wuhanValidated);
end
H=table(sets,old,new,seams(:,1),seams(:,2),'VariableNames',{'camera_set','archive_rms_px','gallery_rms_px','seam1_error_px','seam2_error_px'});
writetable(H,fullfile(out,'catalogue_holdout.csv'));disp(H)
s=kr2_gallery_grip();g=kr2_front_scenario();g.columnAxis=s.shaft;
theta=(-30:.5:30)';v=zeros(numel(theta),3);
for i=1:numel(theta)
    p=steer_pose(g,theta(i));v(i,:)=[p.wheelDeg max(abs(p.rodResidualMM))];
end
assert(all(diff(v(:,1:2))>0,'all') && max(v(:,3))<1e-7 && all(abs(v(theta==0,1:2))<1e-9));
assert(all(v(theta~=0,1)>v(theta~=0,2))); % signed: inner wheel turns further on both sides
T=table(theta,v(:,1),v(:,2),v(:,3),'VariableNames',{'input_deg','left_deg','right_deg','closure_mm'});
writetable(T,fullfile(out,'bench_sweep.csv'));disp(T(ismember(theta,[-25 0 25]),:));
[f,turn,layout]=demo_kr2_direction();finish=onCleanup(@()delete(f(isgraphics(f))));
for q=[0 10 25 10 0 -10 -25 -10 0]
    p=turn(q);
    for a=1:4
        for b=1:2
            h=findobj(f,'Tag',sprintf('heading-%d-%d',a,b));
            assert(isscalar(h) && abs(atan2d(diff(h.YData),diff(h.XData))-p.wheelDeg(b))<1e-8);
        end
    end
    if q==25,exportgraphics(layout,fullfile(out,'bench-left.png'),'Resolution',105);end
end
fprintf('PASS: independent catalogue view, 121 rigid-linkage poses, nine four-view rendered stops.\n');
verify_kr2_cowl_grip(out);
end
