function [a,stats]=kr2_wheel_audit(root)
% Scope the reviewed points to both public clip digests and their own gate clocks.
if nargin==0,[T,~,paths]=kr2_public_gates();else,[T,~,paths]=kr2_public_gates(root);end
folder=fileparts(mfilename('fullpath'));a=readtable(fullfile(folder,'kr2_wheel_image_picks.csv'),'TextType','string');
n=height(T);assert(isequal(a.lap,[4*ones(n,1);5*ones(n,1)]) && isequal(a.gate,repmat((1:n)',2,1)));
refIdx=10;rv=VideoReader(paths(1));rv.CurrentTime=T.video_s_L4(refIdx);reference=readFrame(rv);
anchors=reshape(a{refIdx,4:9},2,3)';
a.video_s=[T.video_s_L4;T.video_s_L5];a.distance_m=repmat(T.distance_m,2,1);
a.status=strings(2*n,1);a.correlation=nan(2*n,1);a.pixel_error=a.correlation;a.angle_error_deg=a.correlation;
a.candidate_deg=a.correlation;a.points=nan(2*n,6);
for j=1:2
    rd=VideoReader(paths(j));
    for k=1:n
        i=(j-1)*n+k;rd.CurrentTime=a.video_s(i);
        r=wheel_image_candidate(readFrame(rd),reference,anchors);
        a.status(i)=r.status;a.correlation(i)=r.score;a.candidate_deg(i)=r.angle;
        a.points(i,:)=reshape(r.points',1,[]);
        if a.visibility(i)=="readable" && r.status=="candidate"
            xy=reshape(a{i,4:9},2,3)';d=xy(3,:)-xy(2,:);
            a.pixel_error(i)=max(vecnorm(r.points-xy,2,2));
            a.angle_error_deg(i)=abs(mod(r.angle-atan2d(-d(2),d(1))+180,360)-180);
        end
    end
end
match=a.pixel_error<=3 & a.angle_error_deg<=5;holdout=a.lap==5;
detected=a.status=="candidate";readable=a.visibility=="readable";
stats=struct('heldoutGates',sum(holdout),'readable',sum(readable&holdout),...
    'correct',sum(holdout&match),'wrong',sum(holdout&detected&~match),'missed',sum(holdout&readable&~detected),...
    'occluded',sum(holdout&~readable),'falseOnOccluded',sum(holdout&~readable&detected));
stats.passed=stats.correct>=4 && stats.wrong==0 && stats.occluded>0;
a.show_image_mark=stats.passed & match;
a.image_angle_deg=a.candidate_deg;a.image_angle_deg(~a.show_image_mark)=nan;
end
