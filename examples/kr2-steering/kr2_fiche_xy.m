function xy=kr2_fiche_xy(uv,source)
% Positive x forward, positive y driver left. All raster picks are zero based.
switch source
    case 'photo'
        % Object 537 is reflected on the published page: increasing native u
        % points UP the rendered sheet. Nose points left there, driver left down.
        xy=[uv(:,2)-433,243-uv(:,1)].*[1050/(433-89.5),638/(346-140.5)];
    case 'plan'
        xy=[270-uv(:,1),uv(:,2)-644.5]*(1050/(761-270));
    otherwise
        error('kart:FicheView','Unknown KR2 fiche view.');
end
end
