function w=kr2_handwheel()
% FIA 023-CH-98 p.1, native 491x551 photo, zero-based (u,v).
% These are image outlines, not a measurement of the 2025 Wuhan handwheel.
outer=[240 285;263 286;277 291;290 298;299 307;305 317;307 330;...
    304 343;298 352;291 359;280 365;263 370;241 372;218 370;205 366;...
    193 360;182 352;176 343;173 330;174 317;179 307;187 299;199 291;217 286];
inner=[240 296;260 297;273 300;281 305;289 313;294 321;295 330;...
    291 341;283 348;271 355;258 359;241 361;225 359;211 354;...
    202 348;194 340;190 330;190 321;193 312;201 306;211 301;221 297];
w.centre=[243 326];w.scale=[296/134 296/87]; % scenario: equal spans before the camera projection
w.theta=(0:2:360)';w.outer=ring(outer);w.inner=ring(inner);
w.halfDepth=13; % mm, assumed grip depth normal to the handwheel plane
% Four branches and three hub fasteners visible in the archive. Sections and
% extensions under the grip are illustrative; no construction spec is implied.
w.spokesUV=[185 305;293 305;289 351;192 351];
w.holesUV=[235 323;251 323;243 332];w.project=@project;
    function pts=project(uv)
        pts=[(uv(:,2)-w.centre(2))*w.scale(2),(w.centre(1)-uv(:,1))*w.scale(1)];
    end
    function xy=ring(uv)
        r=project(uv);[a,ord]=sort(mod(atan2d(r(:,2),r(:,1)),360));d=vecnorm(r(ord,:),2,2);
        rad=interp1([a(end)-360;a;a(1)+360],[d(end);d;d(1)],w.theta,'pchip');
        xy=rad.*[cosd(w.theta) sind(w.theta)];xy(end,:)=xy(1,:);
    end
end
