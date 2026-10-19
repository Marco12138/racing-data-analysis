import { I18nProvider } from "../../frontend/lib/i18n";
import { VideoAnalysisWorkspace } from "../../frontend/components/VideoAnalysisWorkspace";
import { TrackLandmarkEditor } from "../../frontend/components/TrackLandmarkEditor";
import { ReviewBoundaryCheck } from "../../frontend/components/ReviewBoundaryCheck";

export function WorkspaceTest({ locale }: { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><VideoAnalysisWorkspace /></I18nProvider>;
}
export function LandmarkTest({ locale }: { locale: "zh" | "en" }) {
  return <I18nProvider initialLocale={locale}><TrackLandmarkEditor video={{ current:null }} videoUrl="blob:local" scope="pair" cornerId="corner"
    lap={1} videoKey="hash" syncKey="video-only:10" window={{start_s:10,end_s:15}} distanceAtTime={() => null}
    events={{recovery:null,rpm_drop:null}} onSeek={() => {}} videoOnly /></I18nProvider>;
}
export function BoundaryTest({ locale }: { locale: "zh" | "en" }) {
  const video = {url:"blob:local",start:10,duration:50,lap:1,confirmed:true,label:"Driver A"};
  return <I18nProvider initialLocale={locale}><ReviewBoundaryCheck reference={video} target={{...video,label:"Driver B"}} onSeek={() => {}} /></I18nProvider>;
}
