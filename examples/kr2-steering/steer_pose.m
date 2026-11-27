function p = steer_pose(g, theta, innerAtPose)
% Rigid linkage, spherical tie-rod ends. Uses the assembly branch at neutral.
validateattributes(theta,{'numeric'},{'real','finite','scalar'});
if theta < g.inputLimits(1) || theta > g.inputLimits(2)
    error('kart:Range','Steering input outside declared range.');
end
if nargin==3,validateattributes(innerAtPose,{'numeric'},{'real','finite','size',[2 3]});end
p.inner = zeros(2,3); p.outer = p.inner; p.hub = p.inner; p.forward = p.inner;
p.wheelDeg = nan(1,2);p.camberDeg=nan(1,2);p.groundForward=nan(2,3);p.rodResidualMM = zeros(1,2);
p.axleOut=nan(2,3); p.hubRiseMM=nan(1,2);
for i=1:2
    k = g.kingpin(i,:); u = unit(g.kingpinAxis(i,:)); K = g.outer(i,:)-k;
    A0 = g.inner(i,:);
    if nargin==3,A=innerAtPose(i,:);else,A=g.column + rotate3(A0-g.column,unit(g.columnAxis),deg2rad(theta));end
    if ~isfinite(g.rod(i)) || g.rod(i)<=0 || abs(norm(g.outer(i,:)-A0)-g.rod(i))>1e-5
        error('kart:Neutral','Neutral hardpoints and rod length do not close.');
    end
    arm = K-dot(K,u)*u; tangent = cross(u,arm); center = k+dot(K,u)*u;
    v = center-A;
    h = dot(v,arm); j = dot(v,tangent); j0 = dot(center-A0,tangent);
    c = (g.rod(i)^2-dot(v,v)-dot(arm,arm))/2;
    amp = hypot(h,j);
    if amp < 1e-10 || abs(j0)<1e-8 || abs(c)>=amp*(1-1e-12)
        error('kart:Closure','Linkage unreachable or at a toggle; no wheel prediction.');
    end
    q = atan2(j,h)-sign(j0)*acos(c/amp);
    p.inner(i,:) = A;
    p.outer(i,:) = k+rotate3(K,u,q);
    p.hub(i,:) = k+rotate3(g.hub(i,:)-k,u,q);
    p.hubRiseMM(i)=p.hub(i,3)-g.hub(i,3);
    p.forward(i,:) = rotate3(unit(g.forward(i,:)),u,q);
    if isfield(g,'axleOut')
        axle=unit(g.axleOut(i,:));
        if abs(dot(axle,unit(g.forward(i,:))))>1e-6
            error('kart:WheelFrame','Wheel forward and spindle axes must be perpendicular.');
        end
        p.axleOut(i,:)=rotate3(axle,u,q);
        % The trace of the wheel plane on level ground, independent of rim phase.
        trace=cross(p.axleOut(i,:),[0 0 1])*(3-2*i);
        if norm(trace)>1e-9
            p.groundForward(i,:)=trace/norm(trace);
            p.wheelDeg(i)=atan2d(trace(2),trace(1));
        end
        p.camberDeg(i)=atan2d(-p.axleOut(i,3),hypot(p.axleOut(i,1),p.axleOut(i,2)));
    end
    p.rodResidualMM(i) = norm(p.outer(i,:)-A)-g.rod(i);
end
end

function u = unit(v)
if ~isequal(size(v),[1 3]) || any(~isfinite(v)) || norm(v)<1e-12
    error('kart:Axis','Axis or direction vector is not defined.');
end
u = v/norm(v);
end

function y = rotate3(x,u,q)
y = x*cos(q)+cross(u,x)*sin(q)+u*dot(u,x)*(1-cos(q));
end
