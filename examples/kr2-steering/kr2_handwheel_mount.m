function M=kr2_handwheel_mount(g,origin)
% Shared unmeasured shaft-to-wheel station for the two Wuhan KR2 views.
normal=g.columnAxis/norm(g.columnAxis);fore=cross([0 1 0],normal);fore=fore/norm(fore);
M=[fore' cross(normal,fore)' normal' (g.column-origin+350*normal)';0 0 0 1];
end
