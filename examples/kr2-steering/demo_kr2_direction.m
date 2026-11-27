function [f,turn,views]=demo_kr2_direction()
% Public geometry only. The slider is a bench input, never a video estimate.
s=kr2_gallery_grip();g=kr2_front_scenario();g.columnAxis=s.shaft;
rails=kr2_archive_rails();diam=[30 30 30 32 32 32];
mesh=kr2_gallery_grip_mesh(s);sz=size(mesh);U=reshape(mesh,[],3);
tyre=vega_xm4_front();w=[tyre.halfWidth;-flipud(tyre.halfWidth(1:end-1))];
r=[tyre.radial;flipud(tyre.radial(1:end-1))];col=[.04 .53 .51;.83 .36 .13];
f=figure('Name','KR2 | 前桥转向台架','NumberTitle','off','WindowStyle','normal',...
    'Color','w','Position',[55 65 1090 690]);
views=tiledlayout(f,2,2,'Padding','compact','TileSpacing','compact');views.OuterPosition=[.02 .14 .96 .83];
angles=[-50 25;0 90;0 0;90 0];labels={'装配斜视','俯视','侧视','正视'};
for k=1:4
    ax=nexttile(views);hold(ax,'on');axis(ax,'equal');axis(ax,'manual');axis(ax,'off');view(ax,angles(k,:));
    xlim(ax,[-1340 355]);ylim(ax,[-675 675]);zlim(ax,[-165 500]);camproj(ax,'orthographic');title(ax,labels{k});
    for i=1:6
        [X,Y,Z]=frame_tube_mesh(rails{i},diam(i)/2);
        surf(ax,X,Y,Z,'EdgeColor','none','FaceColor',[.56 .60 .61]);
    end
    plot3(ax,[-1050 -1050],[-510 510],[7 7],'Color',[.39 .42 .43],'LineWidth',3);
    segment(ax,[g.column;s.hub],[.36 .38 .39],3);
    ring(k)=surf(ax,mesh(:,:,1),mesh(:,:,2),mesh(:,:,3),'EdgeColor','none','FaceColor',[.21 .22 .23]); %#ok<AGROW>
    for j=1:numel(s.spokeEnds),spoke(k,j)=segment(ax,[s.hub;s.grip(s.spokeEnds(j),:)],[.37 .40 .41],2);end
    for j=1:2
        wheel(k,j)=surf(ax,nan(2),nan(2),nan(2),'EdgeColor','none','FaceColor',[.21 .23 .25]);
        rod(k,j)=segment(ax,[g.inner(j,:);g.outer(j,:)],col(j,:),2.6);
        arm(k,j)=segment(ax,[g.outer(j,:);g.kingpin(j,:);g.hub(j,:)],col(j,:),2.4);
        arrow(k,j)=segment(ax,[g.hub(j,:);g.hub(j,:)+[160 0 0]],col(j,:),3.2);
    end
    camlight(ax,'headlight');lighting(ax,'gouraud');ax.Toolbar.Visible='off';
end
slider=uicontrol(f,'Style','slider','Min',-30,'Max',30,'Value',0,'Units','normalized',...
    'Position',[.12 .062 .45 .045],'SliderStep',[1/60 5/60],'Callback',@(o,~)paint(o.Value));
for i=1:3
    names={'右打 25°','回正','左打 25°'};stops=[-25 0 25];
    uicontrol(f,'Style','pushbutton','Units','normalized','Position',[.60+.105*(i-1) .06 .095 .054],...
        'String',names{i},'Callback',@(~,~)paint(stops(i)));
end
uicontrol(f,'Style','text','Units','normalized','Position',[.005 .005 .99 .039],...
    'String','灰：同号旧认证管架   青：左轮   橙：右轮   |   轮角为假设孔位下的几何输出，不是武汉实测。','BackgroundColor','w');
turn=@paint;paint(25);
    function p=paint(q)
        p=steer_pose(g,q);slider.Value=q;
        R=makehgtform('axisrotate',s.shaft,deg2rad(q));R=R(1:3,1:3);
        V=reshape((U-s.hub)*R'+s.hub,sz);sp=(s.grip(s.spokeEnds,:)-s.hub)*R'+s.hub;
        for a=1:4
            set(ring(a),'XData',V(:,:,1),'YData',V(:,:,2),'ZData',V(:,:,3));
            for b=1:numel(s.spokeEnds),put(spoke(a,b),[s.hub;sp(b,:)]);end
            for b=1:2
                c=wheel_surface(p.hub(b,:),p.forward(b,:),p.axleOut(b,:),w,r,48);
                set(wheel(a,b),'XData',c{1},'YData',c{2},'ZData',c{3});
                put(arm(a,b),[p.outer(b,:);g.kingpin(b,:);p.hub(b,:)]);
                put(rod(a,b),[p.inner(b,:);p.outer(b,:)]);
                put(arrow(a,b),p.hub(b,:)+[0 0 36]+[0;164]*p.groundForward(b,:));
                arrow(a,b).Tag=sprintf('heading-%d-%d',a,b);
            end
        end
        title(views,sprintf('KR2 转向台架    |    方向盘 %+.0f°     左轮 %+.2f°     右轮 %+.2f°',q,p.wheelDeg));
        drawnow;
    end
end
function h=segment(a,v,c,w)
h=plot3(a,v(:,1),v(:,2),v(:,3),'Color',c,'LineWidth',w);
end
function put(h,v),set(h,'XData',v(:,1),'YData',v(:,2),'ZData',v(:,3));end
