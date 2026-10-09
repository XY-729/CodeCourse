import { type MobileWorkspaceTab } from "../shell/mobile/MobileWorkspaceChrome";
import type { AppViewModel } from "./appViewModel";
import { renderMobileAssistantPanel } from "./MobileAssistantView";
import { renderMobileGenerationPanel } from "./MobileGenerationView";
import { renderMobileMePanel } from "./MobileMeView";
import { renderSidebar } from "./NavigationView";


export function renderMobileWorkspaceContent(model: AppViewModel, tab: MobileWorkspaceTab) {

  if (tab === "projects" || tab === "courses" || tab === "files") return renderSidebar(model, tab, true);
  if (tab === "assistant") return renderMobileAssistantPanel(model);
  if (tab === "generation") return renderMobileGenerationPanel(model);
  return renderMobileMePanel(model);

}
