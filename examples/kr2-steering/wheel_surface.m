function xyz=wheel_surface(c,d,a,w,r,sectors)
% Revolve an open meridian about the axle. No sealed volume or material.
assert(isequal(size(c),[1 3]) && isequal(size(d),[1 3]) && isequal(size(a),[1 3]) && ...
    all(isfinite([c d a])) && abs(norm(d)-1)<1e-7 && abs(norm(a)-1)<1e-7 && abs(dot(d,a))<1e-7);
if nargin<6,sectors=48;end
validateattributes(sectors,{'numeric'},{'scalar','integer','>=',8,'finite'});
phi=linspace(0,2*pi,sectors+1);v=cross(d,a);xyz=cell(1,3);
for j=1:3,xyz{j}=c(j)+w(:)*a(j)+r(:)*(cos(phi)*d(j)+sin(phi)*v(j));end
end
