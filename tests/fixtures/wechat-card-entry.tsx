import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StoryboardWechatCard } from "../../frontend/components/StoryboardWechatCard";
import { buildStoryboardMetadata } from "../../frontend/lib/storyboardMetadata";
import type { StoryboardResponse } from "../../frontend/lib/storyboardApi";

export function renderWechatCard(storyboard: StoryboardResponse): string {
  return renderToStaticMarkup(
    <StoryboardWechatCard
      storyboard={storyboard}
      qrDataUrl="data:image/png;base64,fixture"
    />,
  );
}

export { buildStoryboardMetadata };
