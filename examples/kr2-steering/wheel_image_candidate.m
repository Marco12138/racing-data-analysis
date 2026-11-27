function r=wheel_image_candidate(frame,ref,anchors)
% Single-frame localizer trained on the S2 camera only. No lap clock or motion prior.
r=struct('points',nan(3,2),'angle',nan,'score',nan,'status',"no_triangle");
if ~isequal(size(frame),[540 960 3]) || ~isequal(size(frame),size(ref))
    r.status="unsupported_camera";return
end
gray=@(a) .299*double(a(:,:,1))+.587*double(a(:,:,2))+.114*double(a(:,:,3));
x0=660;y0=245;xx=x0:850;yy=y0:334;
im=gray(frame(yy,xx,:));base=gray(ref(yy,xx,:));offset=[x0-1 y0-1];anchors=anchors-offset;
zc=complex(anchors(:,1),anchors(:,2));origin=mean(zc);zc=zc-origin;
[x,y]=meshgrid(floor(min(anchors(:,1)))-8:2:ceil(max(anchors(:,1)))+8,...
    floor(min(anchors(:,2)))-8:2:ceil(max(anchors(:,2)))+8);
grid=complex(x(:),y(:))-origin;
tmpl=interp2(base,x(:),y(:));tmpl=tmpl-mean(tmpl);
if ~all(isfinite(tmpl)) || norm(tmpl)<eps,r.status="invalid_template";return,end
tmpl=tmpl/norm(tmpl);
contrast=conv2(im,ones(5)/25,'same')-conv2(im,ones(13)/169,'same');
contrast([1:7 end-6:end],:)=-inf;contrast(:,[1:7 end-6:end])=-inf;
z=nan(60,1);count=0;
for k=1:numel(z)
    [peak,idx]=max(contrast,[],'all');if peak<6,break,end
    [j,i]=ind2sub(size(im),idx);bw=im(j-2:j+2,i-2:i+2);bw=max(bw-min(bw,[],'all'),0);
    [u,v]=meshgrid(-2:2);z(k)=complex(i,j);
    if sum(bw,'all')>0,z(k)=z(k)+sum(bw.*complex(u,v),'all')/sum(bw,'all');end
    contrast(j-4:j+4,i-4:i+4)=-inf;count=k;
end
z=z(1:count);best=-inf;second=-inf;bestZ=[];
for a=1:count
    for b=reshape(find(imag(z-z(a))>=13 & imag(z-z(a))<=30 & ...
            real(z-z(a))>=-12 & real(z-z(a))<=18),1,[])
        for c=reshape(find(real(z-z(b))>=13 & real(z-z(b))<=32 & ...
                imag(z-z(b))>=-19 & imag(z-z(b))<=5),1,[])
            candidate=z([a;b;c]);center=mean(candidate);rel=candidate-center;
            scale=zc'*rel/(zc'*zc);
            if abs(scale)<.76 || abs(scale)>1.27 || max(abs(scale*zc-rel))>4,continue,end
            at=center+grid*scale;values=interp2(im,real(at),imag(at),'linear',nan);
            if any(~isfinite(values)),continue,end
            values=values-mean(values);score=(tmpl'*values)/max(norm(values),eps);
            if score>best,second=best;best=score;bestZ=candidate;
            elseif score>second,second=score;end
        end
    end
end
if isempty(bestZ),return,end
r.score=best;
if best<.66,r.status="low_contrast_match";return,end
if best-second<.10,r.status="ambiguous";return,end
r.points=[real(bestZ),imag(bestZ)]+offset;
r.angle=atan2d(-imag(bestZ(3)-bestZ(2)),real(bestZ(3)-bestZ(2)));
r.status="candidate";
end
