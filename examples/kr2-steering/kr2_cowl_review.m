function [fig,move,result]=kr2_cowl_review(gate,root)
if nargin<1,gate=10;end
if nargin<2,[T,m,paths]=kr2_public_gates();a=kr2_wheel_audit();
else,[T,m,paths]=kr2_public_gates(root);a=kr2_wheel_audit(root);end
% L4-only seeds in native 960x540 pixel coordinates. Never seed on L5.
seeds=[6 488 342 539 361 562 350;9 446 345 495 363 520 351;...
    10 460 347 513 366 540 352;12 439 349 491 367 517 352;14 440 348 490 364 516 351];
n=height(T);wheel=reshape(a.show_image_mark,n,2);reader={VideoReader(paths(1)),VideoReader(paths(2))};
status=repmat("not_reviewed",n,1);value=nan(n,7);data=cell(n,1);
for j=1:size(seeds,1)
    k=seeds(j,1);if any(m.gpsWarning),status(k)="gps_warning";continue;end
    if ~all(wheel(k,:)),status(k)="wheel_unverified";continue;end
    [L,R]=frames(k);q=kr2_cowl_pair(L,R,reshape(seeds(j,2:end),2,[])');data{k}=q;status(k)=q.status;
    d=a.image_angle_deg(n+k)-a.image_angle_deg(k);value(k,1:5)=[d q.roll q.held q.translationHeld q.rawHeld];
    if q.status=="local_image_match"
        value(k,6)=mod(d-q.roll+180,360)-180;
        % Worst-case angular sensitivity if each endpoint may be off by 2 px.
        len=@(P)norm(diff(P));l4=reshape(a.points(k,:),2,[])';l5=reshape(a.points(n+k,:),2,[])';
        spans=[len(l4(2:3,:)) len(l5(2:3,:)) len(q.ref(1:2,:)) len(q.picked(1:2,:))];
        value(k,7)=sum(asind(min(1,4./spans)));
    end
end
result=[table((1:n)',T.distance_m,status,'VariableNames',{'gate','distance_m','status'}),...
    array2table(value,'VariableNames',{'image_delta_deg','cowl_roll_deg','held_error_px','translation_error_px','no_registration_px','relative_image_deg','sensitivity_2px_deg'})];
fig=figure('Name','KR2 / 武汉 S2 | 手轮相对车鼻','NumberTitle','off','Color','w','Position',[50 100 1110 482]);
t=tiledlayout(fig,1,2,'Padding','compact','TileSpacing','compact');t.OuterPosition=[.015 .23 .97 .72];
for i=1:2,ax(i)=nexttile(t);end
read=uicontrol(fig,'Style','text','Units','normalized','Position',[.015 .14 .97 .068],'BackgroundColor','w','FontSize',12);
slider=uicontrol(fig,'Style','slider','Units','normalized','Position',[.10 .08 .80 .045],'Min',1,'Max',n,...
    'SliderStep',[1 3]/(n-1),'Tag','cowlGate','Callback',@(o,~)show(round(o.Value)));
alert="本节选无已标记 GPS 异常";if any(m.gpsWarning),alert="GPS 异常，停用配对叠线";end
uicontrol(fig,'Style','text','Units','normalized','Position',[.01 .012 .98 .055],'BackgroundColor','w',...
    'String',sprintf('%s · 原人工锚点 %.2f s ±%.1f s · 整段同步未验证。只对照画面，不驱动模型前轮。',alert,m.anchor,m.range));
move=@show;show(gate);
if nargin<2,uimenu(fig,'Text','检验实拍中的 KR 握圈外形','MenuSelectedFcn',@(~,~)demo_kr2_video_grip());
else,uimenu(fig,'Text','检验实拍中的 KR 握圈外形','MenuSelectedFcn',@(~,~)demo_kr2_video_grip(root));end
    function [L,R]=frames(k)
        reader{1}.CurrentTime=T.video_s_L4(k);reader{2}.CurrentTime=T.video_s_L5(k);
        L=readFrame(reader{1});R=readFrame(reader{2});
    end
    function show(k)
        validateattributes(k,{'numeric'},{'scalar','integer','>=',1,'<=',n});slider.Value=k;[L,R]=frames(k);
        for g=1:2
            cla(ax(g));I=L;if g==2,I=R;end
            image(ax(g),I);axis(ax(g),'image');axis(ax(g),'off');hold(ax(g),'on');
            xlim(ax(g),[390 870]);ylim(ax(g),[170 424]);title(ax(g),sprintf('L%d  |  %.2f s',g+3,T.("video_s_L"+(g+3))(k)));
            if wheel(k,g)
                P=reshape(a.points(k+(g-1)*n,:),2,[])';draw(ax(g),P([1:3 1],:),[.1 1 .93],'-o');
            end
        end
        q=data{k};title(t,sprintf('共同门 %d / %d   |   %.1f m',k,n,T.distance_m(k)));
        if status(k)~="local_image_match"
            msg="没有这一门的双圈车鼻核对";if status(k)=="patch_unverified",msg="前包围或检查点辨识不稳";elseif status(k)=="third_patch_mismatch",msg="第三处亮边没有对上";end
            read.String=char(msg+"：只显示原画面，不做补值。");return
        end
        projected=reshape(a.points(k,:),2,[])';z=q.gain*complex(projected(:,1),projected(:,2))+q.offset;
        for g=1:2
            P=q.ref;if g==2,P=q.picked;end
            draw(ax(g),P(1:2,:),[1 .78 .20],'-s');draw(ax(g),P(3,:),[1 1 1],'+');
        end
        h=draw(ax(2),[real(z([1:3 1])) imag(z([1:3 1]))],[1 .61 .12],'--');h.Tag='registeredSpokes';
        title(ax(2),'L5 实拍（青） / 按车鼻摆放的 L4 轮辐（橙虚线）');
        read.String=sprintf('车鼻对齐后，两圈轮辐在画面上相差 %+.1f°。假设取点各偏 2 px，敏感范围可达 ±%.1f°；不是实车转角。',value(k,6:7));
    end
end
function h=draw(ax,P,c,style),h=plot(ax,P(:,1),P(:,2),style,'Color',c,'LineWidth',1.6,'MarkerSize',5);end
