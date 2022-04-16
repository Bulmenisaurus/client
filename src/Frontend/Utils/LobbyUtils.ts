import { entropyToMnemonic, mnemonicToEntropy } from 'bip39';

export const lobbyAddressMnemonic = (
  lobbyNameOrAddress: string
): { address: string; mnemonic: string } => {
  const lobbyAddressOrName = lobbyNameOrAddress;
  let address: string;
  let mnemonic: string;

  if (lobbyAddressOrName.startsWith('0x')) {
    address = lobbyAddressOrName;
    mnemonic = entropyToMnemonic(address.slice(2));
  } else {
    mnemonic = lobbyAddressOrName;
    address = mnemonicToEntropy(mnemonic);
  }

  if (!address.startsWith('0x')) {
    address = '0x' + address;
  }

  return { address, mnemonic };
};
