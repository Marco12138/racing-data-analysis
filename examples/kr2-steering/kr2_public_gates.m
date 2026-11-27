function [T,m,paths] = kr2_public_gates(root)
% Accept only the reviewed public sample revision, never an arbitrary run or private video.
if nargin==0
    work=fileparts(fileparts(fileparts(mfilename('fullpath'))));
    root=fullfile(work,'public','demo');
end
files=["reviewed-real-session.json","coach-evidence.json","video/media.json",...
    "video/sector-2-lap-4.mp4","video/sector-2-lap-5.mp4"];
expected=["866e45157235162ece2dd649111968e02299a3c45e220b446eff0beea1150c49",...
    "d3758d9cf26e4c9c379cfce959d91ee86a387ded7b95dbb082f68793a214af03",...
    "7aa029fb31ea873aab32f2d62702c9e8bf0be6e9bad8060407ca68954e55c6bb",...
    "87662010dabaecb0ddbd85e9e759aff47887a6b4e32dd5b2f8d39317e9475e37",...
    "64d900fae2faa7745949f3ab8ed431e55648a07409abc35c37a6832c937925fa"];
% Hash only fixed, reviewed relative filenames. The user's path never enters a shell.
previous=pwd;cd(root);root=pwd;restore=onCleanup(@()cd(previous));
if isfile('/usr/bin/shasum'),cmd="/usr/bin/shasum -a 256 ";
elseif isfile('/usr/bin/sha256sum'),cmd="/usr/bin/sha256sum ";
else,error('No supported SHA-256 utility. Cannot verify public sample.');end
[status,hashes]=system(cmd+strjoin(files," "));assert(status==0,'Cannot verify public assets.');
lines=splitlines(strtrim(string(hashes)));assert(numel(lines)==numel(expected));
for k=1:numel(expected)
    assert(startsWith(lines(k),expected(k)+" "),'Public sample changed: recheck provenance before analysis.');
end
clear restore
s=jsondecode(fileread(fullfile(root,files(1)))); coach=jsondecode(fileread(fullfile(root,files(2))));
vr=s.analysis.video_review;
section=coach.sections(strcmp({coach.sections.id},'sector_2'));
m=struct('anchor',vr.anchor_video_start_s,'range',vr.anchor_uncertainty_s,'anchorLap',vr.anchor_lap,...
    'wholeRecordingVerified',vr.whole_recording_verified,'gpsWarning',false(1,2),...
    'cameraValidated',coach.independent_video_validation,'downstream',[nan nan],...
    'sessionSHA256',expected(1));
assert(~coach.manual_anchor_modified && strcmp(coach.source_sha256,expected(1)));
paths=fullfile(root,files(4:5));
for j=1:2
    lap=3+j;
    row=section.result.laps([section.result.laps.lap]==lap);
    clip=vr.clips(strcmp({vr.clips.sector_id},section.id) & [vr.clips.lap]==lap);
    assert(isscalar(row) && isscalar(clip) && strcmp(row.registration.status,'accepted'));
    assert(strcmp(row.spatial_profile.method,'shared_directed_spatial_gates') && ...
        strcmp(clip.url,"/demo/"+files(3+j)) && strcmp(clip.alignment_status,'manual_anchor_extrapolated'));
    pts=struct2table(row.spatial_profile.points);
    if j==1, T=table(pts.distance_m,'VariableNames',{'distance_m'}); end
    assert(isequal(T.distance_m,pts.distance_m) && all(diff(pts.session_time_s)>0) && all(diff(pts.distance_m)>0));
    clock=pts.session_time_s-clip.telemetry_start_s;
    assert(all(clock>=0 & clock<clip.duration_s),'A requested frame is outside its own published clip.');
    suffix=string(lap);
    T.("video_s_L"+suffix)=clock; T.("kmh_L"+suffix)=pts.speed;
    T.("rpm_L"+suffix)=pts.rpm; T.("elapsed_L"+suffix)=pts.elapsed_s;
    m.gpsWarning(j)=clip.gps_warning || ismember(lap,section.gps_flagged_laps);
    m.downstream(j)=row.downstream_s;
end
T.L4_gain_s=T.elapsed_L5-T.elapsed_L4;
m.gainThroughDownstream=T.L4_gain_s(end)+diff(m.downstream);
end
