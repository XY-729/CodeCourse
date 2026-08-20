import { lazy, type ComponentProps } from "react";
import AppDialog from "./AppDialog";
import CommandPalette from "./CommandPalette";
import SelectionQuickBar from "./SelectionQuickBar";
import TermActionPopover from "./TermActionPopover";

const LLMSettingsDialog = lazy(() => import("./LLMSettingsDialog"));
const LearnerProfileDialog = lazy(() => import("./LearnerProfileDialog"));
const OutlineQuestionnaireDialog = lazy(() => import("./OutlineQuestionnaireDialog"));
const ContextFilePickerDialog = lazy(() => import("./ContextFilePickerDialog"));
const PromptEditor = lazy(() => import("./PromptEditor"));

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
