function s=kr2_catalogue_rims(otherRims)
% KR K010000I0409A gallery, half-size image coordinates; no bodywork or seat
% points in any camera solve. Return the same cameras for all part studies.
if nargin<1,otherRims=false;end
persistent cache
key=1+logical(otherRims);if numel(cache)>=key && ~isempty(cache{key}),s=cache{key};return;end
g=kr2_front_scenario();p=steer_pose(g,0);rear=kr2_rim_station();
% Nominal unloaded XM4 radii (047-TP-01/02), not rolling ride heights.
rearY=[1;-1]*rear.estimatedSpacing/2;rearZ=(274-260)/2;
for k=1:4 % FL, FR, RL, RR; outer then inner lip
    if k<=2,axis=p.axleOut(k,:);hub=p.hub(k,:);w=g.rim.width;
    else,j=k-2;axis=[0 3-2*j 0];hub=[-1050 rearY(j) rearZ];w=rear.lipWidth(j);end
    s.xyz(2*k-1:2*k,:)=hub+[1;-1]*(w/2)*axis;
end
s.images={'image00003.jpeg','image00012.jpeg','image00031_1.jpeg'};
s.uv={ [601 75;601 111;708 476;696 425;248 69;243 119;206 557;213 457],...
       [447 450;421 417;255 191;nan nan;776 311;730 270;495 106;526 133],...
       [699 336;646 337;212 349;259 348;645 114;582 116;247 124;308 123]};
s.held={[2 8],[2 8],[4 6]};if otherRims,s.held={[4 6],[6 8],[2 8]};end
for j=1:3
    obs=s.uv{j};keep=isfinite(obs(:,1));keep(s.held{j})=false;
    s.camera(j)=kr2_catalogue_camera(s.xyz(keep,:),obs(keep,:));
    s.reprojected{j}=kr2_catalogue_project(s.camera(j),s.xyz);
    s.camError{j}=vecnorm(s.reprojected{j}-obs,2,2);
end
cache{key}=s;
end
