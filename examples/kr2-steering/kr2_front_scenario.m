function g=kr2_front_scenario(caster,armX,rimSource)
% Archive fixes only K, O and the projected rod slopes. All remaining hardpoints are scenarios.
if nargin<1,caster=[8 8];end
if nargin<2,armX=45;end
if nargin<3,rimSource="archive";end
rimSource=string(validatestring(rimSource,{'archive','legacy90'}));
validateattributes(caster,{'numeric'},{'size',[1 2],'real','finite','>',-45,'<',45});
validateattributes(armX,{'numeric'},{'scalar','real','>=',15,'<=',75,'finite'});
f=kr2_front_tangent();sg=[1;-1];g.kingpin=[f.pin zeros(2,1)];g.outer=[f.outer zeros(2,1)];
innerY=sg*16;innerX=f.outer(:,1)+(innerY-f.outer(:,2)).*f.n(:,1)./f.n(:,2);
g.inner=[innerX innerY zeros(2,1)];g.column=[mean(innerX)+armX 0 0];
g.columnAxis=[-sind(30) 0 cosd(30)]; % upper end rearwards; ideal direct steering shaft
g.kingpinAxis=[-tand(caster(:)) -sg*tand(9) ones(2,1)];
g.kingpinAxis=g.kingpinAxis./vecnorm(g.kingpinAxis,2,2);
g.rim=kr2_front_rim();g.rimSource=rimSource;g.rimOffset=g.rim.rimToPin;
if rimSource=="legacy90",g.rimOffset=90;end
g.hub=g.kingpin+[zeros(2,1) sg*g.rimOffset zeros(2,1)];
g.forward=repmat([1 0 0],2,1);g.axleOut=[zeros(2,1) sg zeros(2,1)];
g.rod=vecnorm(g.inner-g.outer,2,2);g.inputLimits=[-30 30];g.caster=caster;
g.label='KR2 同号档案投影 + 假设安装尺寸；不是武汉实车转角';
end
