import { address } from '@darkforest_eth/serde';
import { EthAddress } from '@darkforest_eth/types';
import stringify from 'json-stable-stringify';

/**
 * Represents a lobby which the user can join.
 */
export interface Lobby {
  address: EthAddress;
  name: string;
}

/**
 * This is the key in local storage in which we keep an array of all the public addresses of the
 * lobbies that have been imported into this client.
 */
const LOBBY_LOCAL_STORAGE_KEY = 'KNOWN_LOBBIES';

/**
 * In-memory representation of all the lobbies in this client.
 */
const lobbies: Lobby[] = load();

/**
 * Store all of the lobbies in local storage.
 */
function save() {
  localStorage.setItem(LOBBY_LOCAL_STORAGE_KEY, stringify(lobbies));
}

/**
 * Load all of the lobbies from local storage.
 */
function load(): Lobby[] {
  const lobbies: Lobby[] = [];

  const serializedLobbies = localStorage.getItem(LOBBY_LOCAL_STORAGE_KEY);
  if (serializedLobbies !== null) {
    const addresses = JSON.parse(serializedLobbies) as Lobby[];
    for (const lobby of addresses) {
      lobbies.push(lobby);
    }
  }

  return lobbies;
}

/**
 * Returns the list of lobbies that are logged into the game.
 */
export function getLobbies(): Lobby[] {
  return [...lobbies];
}

/**
 * Adds the given account, and saves it to localstorage.
 */
export function addLobby(account: EthAddress, name: string) {
  lobbies.push({
    address: address(account),
    name: name,
  });

  save();
}
