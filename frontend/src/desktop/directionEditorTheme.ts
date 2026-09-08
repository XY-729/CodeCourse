import type { BeforeMount } from '@monaco-editor/react';

export const DIRECTION_EDITOR_THEME = 'codecourse-direction-dark';

export const registerDirectionEditorTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(DIRECTION_EDITOR_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '87A7B8' },
      { token: 'keyword', foreground: '8CE9FF' },
      { token: 'string', foreground: 'ACDFAE' },
      { token: 'number', foreground: 'FFD08B' },
      { token: 'type.identifier', foreground: 'A9C8FF' },
    ],
    colors: {
      'editor.background': '#081D32', 'editor.foreground': '#D8E6F1',
      'editorGutter.background': '#081D32', 'editorLineNumber.foreground': '#688BA4',
      'editorLineNumber.activeForeground': '#8CE9FF', 'editorCursor.foreground': '#8CE9FF',
      'editor.lineHighlightBackground': '#0D2A45', 'editor.lineHighlightBorder': '#0D2A45',
      'editor.selectionBackground': '#285977', 'editor.inactiveSelectionBackground': '#1B405B',
      'editorIndentGuide.background1': '#24405A', 'editorIndentGuide.activeBackground1': '#5488AB',
      'editorWidget.background': '#041D43', 'editorWidget.foreground': '#E6F6FF',
      'editorWidget.border': '#5488AB', 'input.background': '#021731', 'input.foreground': '#E6F6FF',
      'input.border': '#5488AB', 'focusBorder': '#8CE9FF',
      'editor.findMatchBackground': '#785E20', 'editor.findMatchHighlightBackground': '#514B30',
      'menu.background': '#041D43', 'menu.foreground': '#E6F6FF',
      'menu.selectionBackground': '#10416C', 'menu.selectionForeground': '#F4FBFF',
      'menu.separatorBackground': '#275379', 'menu.border': '#5488AB',
      'scrollbarSlider.background': '#5488AB55', 'scrollbarSlider.hoverBackground': '#5488AB88',
    },
  });
};
