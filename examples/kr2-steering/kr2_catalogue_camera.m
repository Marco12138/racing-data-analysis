function c=kr2_catalogue_camera(x,uv,centre)
% Pinhole, square pixels, fixed optical centre. World in mm. Default
% corresponds to 900 x 600 catalogue views, not the dealer's portrait view.
if nargin<3,centre=[450 300];end
xy=double(x)/1000;image=uv-centre;n=size(x,1);
D=zeros(2*n,9);
for k=1:n
    h=[xy(k,1:2) 1];D(2*k-1,:)=[h zeros(1,3) -image(k,1)*h];
    D(2*k,:)=[zeros(1,3) h -image(k,2)*h];
end
[~,~,V]=svd(D);H=reshape(V(:,end),3,3)';H=H*sign(H(3,3));best=inf;
for f=[550 1000 1800]
    B=diag([1/f 1/f 1])*H;scale=2/(norm(B(:,1))+norm(B(:,2)));B=scale*B;
    [U,~,V]=svd([B(:,1:2) cross(B(:,1),B(:,2))]);R=U*diag([1 1 det(U*V')])*V';t=B(:,3);
    focal=f;lam=.001;
    for it=1:100
        e=errors(R,t,focal);J=zeros(numel(e),7);
        for j=1:7
            step=zeros(7,1);step(j)=1e-5;
            J(:,j)=(errors(rotation(step(1:3))*R,t+step(4:6),focal*exp(step(7)))-e)/1e-5;
        end
        A=J'*J;d=-(A+lam*diag(max(1,diag(A))))\(J'*e);
        R1=rotation(d(1:3))*R;t1=t+d(4:6);f1=focal*exp(d(7));
        z=xy*R1(3,:)'+t1(3);inRange=all(z>.1) && f1>200 && f1<6000;
        if inRange && norm(errors(R1,t1,f1))<norm(e)
            R=R1;t=t1;focal=f1;lam=max(1e-8,lam/3);
            if norm(d)<1e-8,break;end
        else
            lam=lam*5;if lam>1e12,break;end
        end
    end
    err=norm(errors(R,t,focal));if err<best
        best=err;c=struct('R',R,'t',t'*1000,'f',focal,'centre',centre);
    end
end
    function e=errors(R,t,f)
        Q=xy*R'+t';r=f*Q(:,1:2)./Q(:,3)-image;e=r(:);
    end
end
function M=rotation(w)
a=norm(w);K=[0 -w(3) w(2);w(3) 0 -w(1);-w(2) w(1) 0];
if a<1e-10,M=eye(3)+K;else,M=eye(3)+sin(a)/a*K+((1-cos(a))/a^2)*K*K;end
end
