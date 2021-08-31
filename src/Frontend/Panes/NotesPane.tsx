import React, { useState } from 'react';
import styled from 'styled-components';
import dfstyles from '../Styles/dfstyles';
import Editor from 'react-simple-code-editor';
import { ModalHook, ModalName, ModalPane } from '../Views/ModalPane';
import 'prismjs/components/prism-markdown';
import { Padded } from '../Components/CoreUI';
import { ColoredPlanetNameLink } from '../Components/Text';
import { LocationId } from '@darkforest_eth/types';

require('prismjs/themes/prism-dark.css');

const NotesContent = styled(Padded)`
  width: 520px;
  height: 520px;
`;

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

// preserves newlines

const NotesText = styled.div`
  white-space: pre;
  padding: 10px;
  height: 500px;
  width: 500px;
`;

const highlightDfText = (text: string) => {
  // planets
  return text.replace(/(<@[0-9a-z]+>)/gim, '<span class="token string">$&</span>');
};

const convertRawDfText = (value: string) => {
  // thanks to https://stackoverflow.com/q/42307451/13996389
  // converts into array of [str, planetId, str, planetId, etc...]
  const text = value.split(/(<@[0-9a-z]+>)/gim);

  return text.map((p, i) => {
    // only odd indices are matches
    if (i % 2 == 0) {
      return p;
    } else {
      // extract the planet locationId
      const match = p.match(/[0-9a-z]+/gim);
      if (match === null) {
        console.error('Match is null wth?');
        return p;
      }
      const planetId = match[0];
      const planet = df.getPlanetWithId(planetId as LocationId);

      if (!planet) {
        return p;
      }
      return <ColoredPlanetNameLink planet={planet} />;
    }
  });
};

export function NotesPane({ hook }: { hook: ModalHook }) {
  const default_notes_text = `First planet: <@${df.getMyPlanets()[0].locationId}>
My largest planet: <@${
    df
      .getMyPlanets()
      .sort((a, b) => a.planetLevel - b.planetLevel)
      .reverse()[0].locationId
  }>
`.trim();

  const [code, setCode] = useState(default_notes_text);
  const [showRaw, setShowRaw] = useState(true);

  return (
    <ModalPane hook={hook} title={'NotePad'} name={ModalName.Notepad}>
      <NotesContent>
        <EditorContainer>
          {showRaw ? (
            <Editor
              className={'df-editor'}
              onValueChange={setCode}
              value={code}
              highlight={(code) => highlightDfText(code)}
              padding={10}
              style={{
                fontFamily: '"Fira code", "Fira Mono", monospace',
                fontSize: 12,
              }}
              onBlur={() => setShowRaw(false)}
            />
          ) : (
            // onDoubleClick because otherwise clicking on planets would be weird
            <NotesText onDoubleClick={() => setShowRaw(true)}>{convertRawDfText(code)}</NotesText>
          )}
        </EditorContainer>
      </NotesContent>
    </ModalPane>
  );
}
