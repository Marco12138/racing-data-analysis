function uv=kr2_catalogue_project(c,xyz)
q=xyz*c.R'+c.t;uv=c.centre+c.f*q(:,1:2)./q(:,3);
end
