import React from 'react';
import { ModalHook, ModalName, ModalPane } from '../Views/ModalPane';

export function NotesPane({ hook }: { hook: ModalHook }) {
  return (
    <ModalPane hook={hook} title={'NotePad'} name={ModalName.Notepad}>
      <span>Hello, world!</span>
    </ModalPane>
  );
}
