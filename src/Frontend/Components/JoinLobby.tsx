import React, { useState } from 'react';
import dfstyles from '../Styles/dfstyles';
import Button from './Button';
import { Green, Red, Sub } from './Text';
import { entropyToMnemonic, mnemonicToEntropy } from 'bip39';
import { useHistory } from 'react-router-dom';
import { lobbyAddressMnemonic } from '../Utils/LobbyUtils';

const styles: {
  [name: string]: React.CSSProperties;
} = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    margin: '5px 0px',
  },
  hwrapper: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
  },
  btn: {
    background: 'rgba(0, 0, 0, 0)',
    color: dfstyles.colors.text,
    marginLeft: '8pt',
    width: '24pt',
    height: '24pt',
    borderRadius: '12pt',
    lineHeight: '24pt',
    transition: 'background 0.2s, color 0.2s',
  },
  btnHov: {
    color: dfstyles.colors.background,
    background: dfstyles.colors.text,
  },
  input: {
    padding: '4px 8px',
    borderRadius: '5px',
    border: `1px solid ${dfstyles.colors.text}`,
    transition: 'color 0.2s, background 0.2s, width 0.2s',
  },
};

enum LobbyJoinResponse {
  Success,
  Invalid,
}

export const JoinLobby = () => {
  const [lobby, setLobby] = useState('');
  const [status, setStatus] = useState<LobbyJoinResponse | null>(null);

  const [focus, setFocus] = useState<boolean>(false);

  const history = useHistory();

  const doSubmit = async () => {
    try {
      const { mnemonic } = lobbyAddressMnemonic(lobby);

      history.push(`/play/${mnemonic}`);
    } catch (e) {
      setStatus(LobbyJoinResponse.Invalid);
    }
  };

  const responseToLobbyJoin = (response: LobbyJoinResponse): React.ReactNode => {
    if (response === LobbyJoinResponse.Invalid)
      return (
        <Sub>
          <Red>Invalid lobby</Red>
        </Sub>
      );
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.hwrapper}>
        <p
          style={{
            color: dfstyles.colors.text,
          }}
        ></p>

        <input
          style={{
            ...styles.input,
            color: focus ? dfstyles.colors.text : dfstyles.colors.subtext,
            background: focus ? dfstyles.colors.backgroundlighter : 'rgba(0, 0, 0, 0)',
            width: focus ? '9em' : '7em',
          }}
          type='text'
          name={lobby}
          value={lobby}
          onChange={(e) => setLobby(e.target.value)}
          placeholder={'0x0000000000000000000000000000000000000000'}
          onKeyDown={(e) => {
            if (e.keyCode === 13) e.preventDefault();
          }}
          onKeyUp={(e) => {
            e.preventDefault();
            if (e.keyCode === 13) doSubmit();
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
        />

        <Button onClick={doSubmit} style={styles.btn} hoverStyle={styles.btnHov}>
          <span>{'>'}</span>
        </Button>
      </div>
      {status !== null && <p style={{ marginTop: '8px' }}>{responseToLobbyJoin(status)}</p>}
    </div>
  );
};
