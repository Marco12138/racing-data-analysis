function [f,go,T]=demo_kr2_video_grip(root)
if nargin==0,[t,m,paths]=kr2_public_gates();a=kr2_wheel_audit();
else,[t,m,paths]=kr2_public_gates(root);a=kr2_wheel_audit(root);end
s=kr2_gallery_grip();mesh=kr2_gallery_grip_mesh(s);
% These four frames have distinct sky-to-cockpit edges in all four columns.
% No dashboard-versus-rubber identity is assigned to the visible contour.
lap=[4;4;5;5];gate=[10;9;9;10];x=[680 700 720 735]';orders=perms(1:3);
err=nan(4,6);v=cell(4,6);obs=nan(4,4);I=cell(4,1);uv=I;
for j=1:4
    i=gate(j)+(lap(j)-4)*height(t);rd=VideoReader(paths(lap(j)-3));rd.CurrentTime=a.video_s(i);I{j}=readFrame(rd);
    if m.gpsWarning(lap(j)-3) || ~a.show_image_mark(i),continue;end
    uv{j}=reshape(a.points(i,:),2,[])';im=double(im2gray(I{j}));
    for k=1:numel(x)
        rows=(190:223)';line=mean(im(:,x(k)+(-2:2)),2);[contrast,b]=max(line(rows-3)-line(rows+3));
        if contrast>=20,obs(j,k)=rows(b);end
    end
    for k=1:size(orders,1)
        h=kr2_grip_projection(s,mesh,uv{j},orders(k,:));v{j,k}=h;
        y=interp1(h.x,h.y,x,'linear',nan);
        if all(isfinite(y)) && all(isfinite(obs(j,:))),err(j,k)=sqrt(mean((y-obs(j,:)').^2));end
    end
end
ranked=err(1,:);ranked(~isfinite(ranked))=inf;[score,best]=min(ranked);hasFit=isfinite(score);
T=table(lap,gate,obs,err(:,best),'VariableNames',{'lap','gate','picked_upper_y','upper_rms_px'});T.fit=[hasFit;false;false;false];
T.bolt_order=repmat(orders(best,:),4,1);T.shaft_angle_deg=nan(4,1);
% Give a horizontal reference the same one training frame. Later frames supply
% only the spoke centre and triangle size, not their observed upper edge.
level=@(p)mean(p(:,2));span=@(p)norm(p-mean(p,1),'fro');
dz=nan;if hasFit,dz=(mean(obs(1,:))-level(uv{1}))/span(uv{1});else,T.bolt_order(:)=nan;T.upper_rms_px(:)=nan;end;T.predicted_upper_y=nan(4,4);
T.flat_rms_px=nan(4,1);
for j=1:4
    h=v{j,best};if ~hasFit || isempty(h),continue;end
    T.predicted_upper_y(j,:)=interp1(h.x,h.y,x,'linear',nan)';
    T.flat_rms_px(j)=sqrt(mean((level(uv{j})+dz*span(uv{j})-obs(j,:)).^2));
end
T.mean_signed_px=mean(T.predicted_upper_y-obs,2); % positive is below the visible edge
f=figure('Name','KR2 | 展车握圈与武汉画面','NumberTitle','off','Color','w','Position',[80 100 950 550]);
ax=axes(f,'Position',[.035 .18 .93 .68]);choice=uicontrol(f,'Style','popupmenu','Units','normalized',...
    'Position',[.17 .88 .66 .07],'Tag','videoGripChoice','String',{'L4 / 门 10 · 选取三点对应关系',...
    'L4 / 门 9 · 检验','L5 / 门 9 · 检验','L5 / 门 10 · 检验'},'Callback',@(h,~)show(h.Value));
msg=uicontrol(f,'Style','text','Units','normalized','Position',[.025 .095 .95 .055],'BackgroundColor','w','FontSize',12);
gps="本节选无已标记 GPS 异常";if any(m.gpsWarning),gps="本节选有 GPS 异常";end
uicontrol(f,'Style','text','Units','normalized','Position',[.01 .012 .98 .06],'BackgroundColor','w','FontSize',10,...
    'String',sprintf('%s · 锚点 %.2f ±%.1f s，整段同步未验证。各帧分别试放；不反推手轮或前轮转角。',gps,m.anchor,m.range));
go=@show;show(4);
    function show(j)
        choice.Value=j;cla(ax);image(ax,I{j});axis(ax,'image');axis(ax,'off');hold(ax,'on');ax.Toolbar.Visible='off';
        xlim(ax,[595 893]);ylim(ax,[147 342]);h=v{j,best};
        if ~hasFit || isempty(h),msg.String='缺少可靠的轮辐、上沿或 GPS 配对，不显示试放。';return;end
        plot(ax,h.x,h.y,':','Color',[1 .78 .20],'LineWidth',1.3);
        take=h.x>=min(x) & h.x<=max(x);
        plot(ax,h.x(take),h.y(take),'Color',[1 .78 .20],'LineWidth',2,'Tag','checkedUpperSpan');
        plot(ax,uv{j}(:,1),uv{j}(:,2),'o','Color',[.08 1 .90],'LineWidth',1.6);
        plot(ax,x,obs(j,:)','+','Color',[1 1 1],'MarkerSize',10,'LineWidth',1.8);
        title(ax,'白十字：实拍上沿    黄色实线：与四点比较的段    虚线：未核对    青圈：摆放点');
        if isfinite(T.upper_rms_px(j)),msg.String=sprintf('中央上沿误差：模型 %.1f px，平线 %.1f px（均方根）。看不清的两侧不计分。',T.upper_rms_px(j),T.flat_rms_px(j));
        else,msg.String='上沿证据不全，不计算轮廓误差。';end
    end
end
