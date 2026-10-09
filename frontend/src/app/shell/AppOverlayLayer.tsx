import { lazy, type ComponentProps } from "react";
import AppDialog from "../../components/overlays/AppDialog";
import CommandPalette from "../../components/overlays/CommandPalette";
import SelectionQuickBar from "../../features/reader/SelectionQuickBar";
import TermActionPopover from "../../features/teaching/TermActionPopover";

const LLMSettingsDialog = lazy(() => import("../../features/settings/LLMSettingsDialog"));
const LearnerProfileDialog = lazy(() => import("../../features/settings/LearnerProfileDialog"));
const OutlineQuestionnaireDialog = lazy(() => import("../../features/generation/OutlineQuestionnaireDialog"));
const ContextFilePickerDialog = lazy(() => import("../../components/overlays/ContextFilePickerDialog"));
const PromptEditor = lazy(() => import("../../features/settings/PromptEditor"));

type Props = {
  termAction: ComponentProps<typeof TermActionPopover> | null;
  settings: ComponentProps<typeof LLMSettingsDialog>;
  learnerProfile: ComponentProps<typeof LearnerProfileDialog>;
  promptEditor: ComponentProps<typeof PromptEditor> | null;
  selectionBar: ComponentProps<typeof SelectionQuickBar> | null;
  commandPalette: ComponentProps<typeof CommandPalette>;
  appDialog: ComponentProps<typeof AppDialog>;
  outlineQuestionnaire: ComponentProps<typeof OutlineQuestionnaireDialog>;
  contextFilePicker: ComponentProps<typeof ContextFilePickerDialog>;
};

export default function AppOverlayLayer(props: Props) {
  return (
    <>
      {props.termAction ? <TermActionPopover {...props.termAction} /> : null}
      <LLMSettingsDialog {...props.settings} />
      <LearnerProfileDialog {...props.learnerProfile} />
      {props.promptEditor ? <PromptEditor {...props.promptEditor} /> : null}
      {props.selectionBar ? <SelectionQuickBar {...props.selectionBar} /> : null}
      <CommandPalette {...props.commandPalette} />
      <AppDialog {...props.appDialog} />
      <OutlineQuestionnaireDialog {...props.outlineQuestionnaire} />
      <ContextFilePickerDialog {...props.contextFilePicker} />
    </>
  );
}
