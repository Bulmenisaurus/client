import React, { useState } from 'react';
import styled from 'styled-components';
import dfstyles from '../Styles/dfstyles';
import Editor from 'react-simple-code-editor';
import { ModalHook, ModalName, ModalPane } from '../Views/ModalPane';
import Prism from 'prismjs';
import 'prismjs/components/prism-markdown';
import { Padded } from '../Components/CoreUI';

require('prismjs/themes/prism-dark.css');

const EditorContainer = styled.div`
  overflow-y: scroll;
  border: 1px solid ${dfstyles.colors.borderDark};
  border-radius: ${dfstyles.borderRadius};
  width: 500px;
  height: 500px;

  .df-editor {
    width: 100%;
    min-height: 100%;
  }
`;

export function NotesPane({ hook }: { hook: ModalHook }) {
  const [code, setCode] = useState('# Hello, world');

  return (
    <ModalPane hook={hook} title={'NotePad'} name={ModalName.Notepad}>
      <Padded>
        <EditorContainer>
          <Editor
            className={'df-editor'}
            onValueChange={setCode}
            value={code}
            highlight={(code) => Prism.highlight(code, Prism.languages.markdown, 'markdown')}
            padding={10}
            style={{
              fontFamily: '"Fira code", "Fira Mono", monospace',
              fontSize: 12,
            }}
          />
        </EditorContainer>
      </Padded>
    </ModalPane>
  );
}
