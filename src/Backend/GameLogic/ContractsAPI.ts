import {
  EMPTY_ADDRESS,
  EMPTY_LOCATION_ID,
  MAX_PLANET_LEVEL,
  MIN_PLANET_LEVEL,
} from '@darkforest_eth/constants';
import { DarkForest } from '@darkforest_eth/contracts/typechain';
import { bonusFromHex, getBytesFromHex } from '@darkforest_eth/hexgen';
import {
  aggregateBulkGetter,
  ContractCaller,
  EthConnection,
  ethToWei,
  TxCollection,
  TxExecutor,
} from '@darkforest_eth/network';
import {
  address,
  artifactIdFromEthersBN,
  artifactIdToDecStr,
  decodeArrival,
  decodeArtifact,
  decodeArtifactPointValues,
  decodePlanet,
  decodePlanetDefaults,
  decodePlayer,
  decodeRevealedCoords,
  decodeUpgradeBranches,
  locationIdFromEthersBN,
  locationIdToDecStr,
} from '@darkforest_eth/serde';
import {
  Artifact,
  ArtifactId,
  ArtifactType,
  AutoGasSetting,
  Biome,
  DiagnosticUpdater,
  EthAddress,
  LocatablePlanet,
  LocationId,
  Planet,
  PlanetLevel,
  PlanetType,
  Player,
  QueuedArrival,
  RevealedCoords,
  Setting,
  SpaceType,
  Transaction,
  TransactionId,
  TxIntent,
  VoyageId,
  WorldLocation,
} from '@darkforest_eth/types';
import bigInt from 'big-integer';
import { BigNumber as EthersBN, ContractFunction, Event, providers } from 'ethers';
import { EventEmitter } from 'events';
import _ from 'lodash';
import NotificationManager from '../../Frontend/Game/NotificationManager';
import { openConfirmationWindowForTransaction } from '../../Frontend/Game/Popups';
import { getSetting } from '../../Frontend/Utils/SettingsHooks';
import {
  ContractConstants,
  ContractEvent,
  ContractsAPIEvent,
  PlanetTypeWeightsBySpaceType,
} from '../../_types/darkforest/api/ContractsAPITypes';
import { loadDiamondContract } from '../Network/Blockchain';
import { eventLogger, EventType } from '../Network/EventLogger';

interface ContractsApiConfig {
  connection: EthConnection;
  contractAddress: EthAddress;
}

/**
 * Roughly contains methods that map 1:1 with functions that live in the contract. Responsible for
 * reading and writing to and from the blockchain.
 *
 * @todo don't inherit from {@link EventEmitter}. instead use {@link Monomitter}
 */
export class ContractsAPI extends EventEmitter {
  /**
   * Don't allow users to submit txs if balance falls below this amount/
   */
  private static readonly MIN_BALANCE = ethToWei(0.002);

  /**
   * Instrumented {@link ThrottledConcurrentQueue} for blockchain reads.
   */
  private readonly contractCaller: ContractCaller;

  /**
   * Instrumented {@link ThrottledConcurrentQueue} for blockchain writes.
   */
  public readonly txExecutor: TxExecutor;

  /**
   * Our connection to the blockchain. In charge of low level networking, and also of the burner
   * wallet.
   */
  public readonly ethConnection: EthConnection;

  /**
   * The contract address is saved on the object upon construction
   */
  private contractAddress: EthAddress;

  get contract() {
    return this.ethConnection.getContract<DarkForest>(this.contractAddress);
  }

  public constructor({ connection, contractAddress }: ContractsApiConfig) {
    super();
    this.contractCaller = new ContractCaller();
    this.ethConnection = connection;
    this.contractAddress = contractAddress;
    this.txExecutor = new TxExecutor(
      connection,
      this.getGasFeeForTransaction.bind(this),
      this.beforeQueued.bind(this),
      this.beforeTransaction.bind(this),
      this.afterTransaction.bind(this)
    );

    this.setupEventListeners();
  }

  /**
   * We pass this function into {@link TxExecutor} to calculate what gas fee we should use for the
   * given transaction. The result is either a number, measured in gwei, represented as a string, or
   * a string representing that we want to use an auto gas setting.
   */
  private getGasFeeForTransaction(tx: Transaction): AutoGasSetting | string {
    if (
      (tx.intent.methodName === 'initializePlayer' || tx.intent.methodName === 'getSpaceShips') &&
      tx.intent.contract.address === this.contract.address
    ) {
      return '50';
    }

    const config = {
      contractAddress: this.contractAddress,
      account: this.ethConnection.getAddress(),
    };

    return getSetting(config, Setting.GasFeeGwei);
  }

  /**
   * This function is called by {@link TxExecutor} before a transaction is queued.
   * It gives the client an opportunity to prevent a transaction from being queued based
   * on business logic or user interaction.
   *
   * Reject the promise to prevent the queued transaction from being queued.
   */
  private async beforeQueued(
    id: TransactionId,
    intent: TxIntent,
    overrides?: providers.TransactionRequest
  ): Promise<void> {
    const address = this.ethConnection.getAddress();
    if (!address) throw new Error("can't send a transaction, no signer");

    const balance = await this.ethConnection.loadBalance(address);

    if (balance.lt(ContractsAPI.MIN_BALANCE)) {
      const notifsManager = NotificationManager.getInstance();
      notifsManager.balanceEmpty();
      throw new Error('xDAI balance too low!');
    }

    const gasFeeGwei = EthersBN.from(overrides?.gasPrice || '1000000000');

    await openConfirmationWindowForTransaction({
      contractAddress: this.contractAddress,
      connection: this.ethConnection,
      id,
      intent,
      overrides,
      from: address,
      gasFeeGwei,
    });
  }

  /**
   * This function is called by {@link TxExecutor} before each transaction. It gives the client an
   * opportunity to prevent a transaction from going through based on business logic or user
   * interaction. To prevent the queued transaction from being submitted, throw an Error.
   */
  private async beforeTransaction(tx: Transaction): Promise<void> {
    this.emit(ContractsAPIEvent.TxProcessing, tx);
  }

  private async afterTransaction(_txRequest: Transaction, txDiagnosticInfo: unknown) {
    eventLogger.logEvent(EventType.Transaction, txDiagnosticInfo);
  }

  public destroy(): void {
    this.removeEventListeners();
  }

  private makeCall<T>(contractViewFunction: ContractFunction<T>, args: unknown[] = []): Promise<T> {
    return this.contractCaller.makeCall(contractViewFunction, args);
  }

  public async setupEventListeners(): Promise<void> {
    const { contract } = this;

    const filter = {
      address: contract.address,
      topics: [
        [
          contract.filters.ArrivalQueued(null, null, null, null, null).topics,
          contract.filters.ArtifactActivated(null, null, null).topics,
          contract.filters.ArtifactDeactivated(null, null, null).topics,
          contract.filters.ArtifactDeposited(null, null, null).topics,
          contract.filters.ArtifactFound(null, null, null).topics,
          contract.filters.ArtifactWithdrawn(null, null, null).topics,
          contract.filters.LocationRevealed(null, null, null, null).topics,
          contract.filters.PlanetHatBought(null, null, null).topics,
          contract.filters.PlanetProspected(null, null).topics,
          contract.filters.PlanetSilverWithdrawn(null, null, null).topics,
          contract.filters.PlanetTransferred(null, null, null).topics,
          contract.filters.PlanetInvaded(null, null).topics,
          contract.filters.PlanetCaptured(null, null).topics,
          contract.filters.PlayerInitialized(null, null).topics,
          contract.filters.AdminOwnershipChanged(null, null).topics,
          contract.filters.AdminGiveSpaceship(null, null).topics,
          contract.filters.PauseStateChanged(null).topics,
          contract.filters.LobbyCreated(null, null).topics,
        ].map((topicsOrUndefined) => (topicsOrUndefined || [])[0]),
      ] as Array<string | Array<string>>,
    };

    const eventHandlers = {
      [ContractEvent.PauseStateChanged]: (paused: boolean) => {
        this.emit(ContractsAPIEvent.PauseStateChanged, paused);
      },
      [ContractEvent.AdminOwnershipChanged]: (location: EthersBN, _newOwner: string) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location));
      },
      [ContractEvent.AdminGiveSpaceship]: (
        location: EthersBN,
        _newOwner: string,
        _type: ArtifactType
      ) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location));
      },
      [ContractEvent.ArtifactFound]: (
        _playerAddr: string,
        rawArtifactId: EthersBN,
        loc: EthersBN
      ) => {
        const artifactId = artifactIdFromEthersBN(rawArtifactId);
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(loc));
      },
      [ContractEvent.ArtifactDeposited]: (
        _playerAddr: string,
        rawArtifactId: EthersBN,
        loc: EthersBN
      ) => {
        const artifactId = artifactIdFromEthersBN(rawArtifactId);
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(loc));
      },
      [ContractEvent.ArtifactWithdrawn]: (
        _playerAddr: string,
        rawArtifactId: EthersBN,
        loc: EthersBN
      ) => {
        const artifactId = artifactIdFromEthersBN(rawArtifactId);
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(loc));
      },
      [ContractEvent.ArtifactActivated]: (
        _playerAddr: string,
        rawArtifactId: EthersBN,
        loc: EthersBN
      ) => {
        const artifactId = artifactIdFromEthersBN(rawArtifactId);
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(loc));
      },
      [ContractEvent.ArtifactDeactivated]: (
        _playerAddr: string,
        rawArtifactId: EthersBN,
        loc: EthersBN
      ) => {
        const artifactId = artifactIdFromEthersBN(rawArtifactId);
        this.emit(ContractsAPIEvent.ArtifactUpdate, artifactId);
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(loc));
      },
      [ContractEvent.PlayerInitialized]: async (player: string, locRaw: EthersBN, _: Event) => {
        this.emit(ContractsAPIEvent.PlayerUpdate, address(player));
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(locRaw));
        this.emit(ContractsAPIEvent.RadiusUpdated);
      },
      [ContractEvent.PlanetTransferred]: async (
        _senderAddress: string,
        planetId: EthersBN,
        receiverAddress: string,
        _: Event
      ) => {
        this.emit(
          ContractsAPIEvent.PlanetTransferred,
          locationIdFromEthersBN(planetId),
          address(receiverAddress)
        );
      },
      [ContractEvent.ArrivalQueued]: async (
        playerAddr: string,
        arrivalId: EthersBN,
        fromLocRaw: EthersBN,
        toLocRaw: EthersBN,
        _artifactIdRaw: EthersBN,
        _: Event
      ) => {
        this.emit(
          ContractsAPIEvent.ArrivalQueued,
          arrivalId.toString() as VoyageId,
          locationIdFromEthersBN(fromLocRaw),
          locationIdFromEthersBN(toLocRaw)
        );
        this.emit(ContractsAPIEvent.PlayerUpdate, address(playerAddr));
        this.emit(ContractsAPIEvent.RadiusUpdated);
      },
      [ContractEvent.PlanetUpgraded]: async (
        _playerAddr: string,
        location: EthersBN,
        _branch: EthersBN,
        _toBranchLevel: EthersBN,
        _: Event
      ) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location));
      },
      [ContractEvent.PlanetInvaded]: async (_playerAddr: string, location: EthersBN, _: Event) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location));
      },
      [ContractEvent.PlanetCaptured]: async (_playerAddr: string, location: EthersBN, _: Event) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location));
      },
      [ContractEvent.PlanetHatBought]: async (
        _playerAddress: string,
        location: EthersBN,
        _: Event
      ) => this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location)),
      [ContractEvent.LocationRevealed]: async (
        revealerAddr: string,
        location: EthersBN,
        _x: EthersBN,
        _y: EthersBN,
        _: Event
      ) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location));
        this.emit(
          ContractsAPIEvent.LocationRevealed,
          locationIdFromEthersBN(location),
          address(revealerAddr.toLowerCase())
        );
        this.emit(ContractsAPIEvent.PlayerUpdate, address(revealerAddr));
      },
      [ContractEvent.PlanetSilverWithdrawn]: async (
        player: string,
        location: EthersBN,
        _amount: EthersBN,
        _: Event
      ) => {
        this.emit(ContractsAPIEvent.PlanetUpdate, locationIdFromEthersBN(location));
        this.emit(ContractsAPIEvent.PlayerUpdate, address(player));
      },
      [ContractEvent.LobbyCreated]: (ownerAddr: string, lobbyAddr: string) => {
        this.emit(ContractsAPIEvent.LobbyCreated, address(ownerAddr), address(lobbyAddr));
      },
    };

    this.ethConnection.subscribeToContractEvents(contract, eventHandlers, filter);
  }

  public removeEventListeners(): void {
    const { contract } = this;

    contract.removeAllListeners(ContractEvent.PlayerInitialized);
    contract.removeAllListeners(ContractEvent.ArrivalQueued);
    contract.removeAllListeners(ContractEvent.PlanetUpgraded);
    contract.removeAllListeners(ContractEvent.PlanetHatBought);
    contract.removeAllListeners(ContractEvent.PlanetTransferred);
    contract.removeAllListeners(ContractEvent.ArtifactFound);
    contract.removeAllListeners(ContractEvent.ArtifactDeposited);
    contract.removeAllListeners(ContractEvent.ArtifactWithdrawn);
    contract.removeAllListeners(ContractEvent.ArtifactActivated);
    contract.removeAllListeners(ContractEvent.ArtifactDeactivated);
    contract.removeAllListeners(ContractEvent.LocationRevealed);
    contract.removeAllListeners(ContractEvent.PlanetSilverWithdrawn);
    contract.removeAllListeners(ContractEvent.PlanetInvaded);
    contract.removeAllListeners(ContractEvent.PlanetCaptured);
  }

  public getContractAddress(): EthAddress {
    return this.contractAddress;
  }

  async getConstants(): Promise<ContractConstants> {
    const {
      DISABLE_ZK_CHECKS,
      PLANETHASH_KEY,
      SPACETYPE_KEY,
      BIOMEBASE_KEY,
      PERLIN_LENGTH_SCALE,
      PERLIN_MIRROR_X,
      PERLIN_MIRROR_Y,
    } = await this.makeCall(this.contract.getSnarkConstants);
    const {
      ADMIN_CAN_ADD_PLANETS,
      WORLD_RADIUS_LOCKED,
      WORLD_RADIUS_MIN,
      MAX_NATURAL_PLANET_LEVEL,
      TIME_FACTOR_HUNDREDTHS,
      PERLIN_THRESHOLD_1,
      PERLIN_THRESHOLD_2,
      PERLIN_THRESHOLD_3,
      INIT_PERLIN_MIN,
      INIT_PERLIN_MAX,
      SPAWN_RIM_AREA,
      BIOME_THRESHOLD_1,
      BIOME_THRESHOLD_2,
      SILVER_SCORE_VALUE,
      // TODO: Actually put this in game constants
      // PLANET_LEVEL_THRESHOLDS,
      PLANET_RARITY,
      PLANET_TRANSFER_ENABLED,
      PHOTOID_ACTIVATION_DELAY,
      LOCATION_REVEAL_COOLDOWN,
      SPACE_JUNK_ENABLED,
      SPACE_JUNK_LIMIT,
      PLANET_LEVEL_JUNK,
      ABANDON_SPEED_CHANGE_PERCENT,
      ABANDON_RANGE_CHANGE_PERCENT,
      // Capture Zones
      GAME_START_BLOCK,
      CAPTURE_ZONES_ENABLED,
      CAPTURE_ZONE_COUNT,
      CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL,
      CAPTURE_ZONE_RADIUS,
      CAPTURE_ZONE_PLANET_LEVEL_SCORE,
      CAPTURE_ZONE_HOLD_BLOCKS_REQUIRED,
      CAPTURE_ZONES_PER_5000_WORLD_RADIUS,
    } = await this.makeCall(this.contract.getGameConstants);

    const TOKEN_MINT_END_SECONDS = (
      await this.makeCall(this.contract.TOKEN_MINT_END_TIMESTAMP)
    ).toNumber();

    const adminAddress = address(await this.makeCall(this.contract.adminAddress));

    const upgrades = decodeUpgradeBranches(await this.makeCall(this.contract.getUpgrades));

    const PLANET_TYPE_WEIGHTS: PlanetTypeWeightsBySpaceType =
      await this.makeCall<PlanetTypeWeightsBySpaceType>(this.contract.getTypeWeights);

    const rawPointValues = await this.makeCall(this.contract.getArtifactPointValues);
    const ARTIFACT_POINT_VALUES = decodeArtifactPointValues(rawPointValues);

    const planetDefaults = decodePlanetDefaults(await this.makeCall(this.contract.getDefaultStats));

    const planetLevelThresholds = (
      await this.makeCall<EthersBN[]>(this.contract.getPlanetLevelThresholds)
    ).map((x: EthersBN) => x.toNumber());

    const planetCumulativeRarities = (
      await this.makeCall<EthersBN[]>(this.contract.getCumulativeRarities)
    ).map((x: EthersBN) => x.toNumber());

    const constants: ContractConstants = {
      ADMIN_CAN_ADD_PLANETS,
      WORLD_RADIUS_LOCKED,
      WORLD_RADIUS_MIN: WORLD_RADIUS_MIN.toNumber(),

      DISABLE_ZK_CHECKS,

      PLANETHASH_KEY: PLANETHASH_KEY.toNumber(),
      SPACETYPE_KEY: SPACETYPE_KEY.toNumber(),
      BIOMEBASE_KEY: BIOMEBASE_KEY.toNumber(),
      PERLIN_LENGTH_SCALE: PERLIN_LENGTH_SCALE.toNumber(),
      PERLIN_MIRROR_X,
      PERLIN_MIRROR_Y,
      CLAIM_PLANET_COOLDOWN: 0,
      TOKEN_MINT_END_SECONDS,
      MAX_NATURAL_PLANET_LEVEL: MAX_NATURAL_PLANET_LEVEL.toNumber(),
      TIME_FACTOR_HUNDREDTHS: TIME_FACTOR_HUNDREDTHS.toNumber(),
      PERLIN_THRESHOLD_1: PERLIN_THRESHOLD_1.toNumber(),
      PERLIN_THRESHOLD_2: PERLIN_THRESHOLD_2.toNumber(),
      PERLIN_THRESHOLD_3: PERLIN_THRESHOLD_3.toNumber(),
      INIT_PERLIN_MIN: INIT_PERLIN_MIN.toNumber(),
      INIT_PERLIN_MAX: INIT_PERLIN_MAX.toNumber(),
      BIOME_THRESHOLD_1: BIOME_THRESHOLD_1.toNumber(),
      BIOME_THRESHOLD_2: BIOME_THRESHOLD_2.toNumber(),
      SILVER_SCORE_VALUE: SILVER_SCORE_VALUE.toNumber(),
      PLANET_LEVEL_THRESHOLDS: [
        planetLevelThresholds[0],
        planetLevelThresholds[1],
        planetLevelThresholds[2],
        planetLevelThresholds[3],
        planetLevelThresholds[4],
        planetLevelThresholds[5],
        planetLevelThresholds[6],
        planetLevelThresholds[7],
        planetLevelThresholds[8],
        planetLevelThresholds[9],
      ],
      PLANET_RARITY: PLANET_RARITY.toNumber(),
      PLANET_TRANSFER_ENABLED,
      PLANET_TYPE_WEIGHTS,
      ARTIFACT_POINT_VALUES,

      SPACE_JUNK_ENABLED,
      SPACE_JUNK_LIMIT: SPACE_JUNK_LIMIT.toNumber(),
      PLANET_LEVEL_JUNK: [
        PLANET_LEVEL_JUNK[0].toNumber(),
        PLANET_LEVEL_JUNK[1].toNumber(),
        PLANET_LEVEL_JUNK[2].toNumber(),
        PLANET_LEVEL_JUNK[3].toNumber(),
        PLANET_LEVEL_JUNK[4].toNumber(),
        PLANET_LEVEL_JUNK[5].toNumber(),
        PLANET_LEVEL_JUNK[6].toNumber(),
        PLANET_LEVEL_JUNK[7].toNumber(),
        PLANET_LEVEL_JUNK[8].toNumber(),
        PLANET_LEVEL_JUNK[9].toNumber(),
      ],
      ABANDON_SPEED_CHANGE_PERCENT: ABANDON_RANGE_CHANGE_PERCENT.toNumber(),
      ABANDON_RANGE_CHANGE_PERCENT: ABANDON_SPEED_CHANGE_PERCENT.toNumber(),

      PHOTOID_ACTIVATION_DELAY: PHOTOID_ACTIVATION_DELAY.toNumber(),
      SPAWN_RIM_AREA: SPAWN_RIM_AREA.toNumber(),
      LOCATION_REVEAL_COOLDOWN: LOCATION_REVEAL_COOLDOWN.toNumber(),

      defaultPopulationCap: planetDefaults.populationCap,
      defaultPopulationGrowth: planetDefaults.populationGrowth,
      defaultRange: planetDefaults.range,
      defaultSpeed: planetDefaults.speed,
      defaultDefense: planetDefaults.defense,
      defaultSilverGrowth: planetDefaults.silverGrowth,
      defaultSilverCap: planetDefaults.silverCap,
      defaultBarbarianPercentage: planetDefaults.barbarianPercentage,
      planetLevelThresholds,
      planetCumulativeRarities,
      upgrades,

      adminAddress,
      // Capture Zones
      GAME_START_BLOCK: GAME_START_BLOCK.toNumber(),
      CAPTURE_ZONES_ENABLED,
      CAPTURE_ZONE_COUNT: CAPTURE_ZONE_COUNT.toNumber(),
      CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL: CAPTURE_ZONE_CHANGE_BLOCK_INTERVAL.toNumber(),
      CAPTURE_ZONE_RADIUS: CAPTURE_ZONE_RADIUS.toNumber(),
      CAPTURE_ZONE_PLANET_LEVEL_SCORE: [
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[0].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[1].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[2].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[3].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[4].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[5].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[6].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[7].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[8].toNumber(),
        CAPTURE_ZONE_PLANET_LEVEL_SCORE[9].toNumber(),
      ],
      CAPTURE_ZONE_HOLD_BLOCKS_REQUIRED: CAPTURE_ZONE_HOLD_BLOCKS_REQUIRED.toNumber(),
      CAPTURE_ZONES_PER_5000_WORLD_RADIUS: CAPTURE_ZONES_PER_5000_WORLD_RADIUS.toNumber(),
    };

    return constants;
  }

  public async getPlayers(
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Map<string, Player>> {
    const nPlayers: number = (await this.makeCall<EthersBN>(this.contract.getNPlayers)).toNumber();

    const players = await aggregateBulkGetter<Player>(
      nPlayers,
      200,
      async (start, end) =>
        (await this.makeCall(this.contract.bulkGetPlayers, [start, end])).map(decodePlayer),
      onProgress
    );

    const playerMap: Map<EthAddress, Player> = new Map();
    for (const player of players) {
      playerMap.set(player.address, player);
    }
    return playerMap;
  }

  public async getPlayerById(playerId: EthAddress): Promise<Player | undefined> {
    const rawPlayer = await this.makeCall(this.contract.players, [playerId]);
    if (!rawPlayer.isInitialized) return undefined;
    const player = decodePlayer(rawPlayer);

    return player;
  }

  public async getWorldRadius(): Promise<number> {
    const radius = (await this.makeCall<EthersBN>(this.contract.worldRadius)).toNumber();
    return radius;
  }

  // timestamp since epoch (in seconds)
  public async getTokenMintEndTimestamp(): Promise<number> {
    const timestamp = (
      await this.makeCall<EthersBN>(this.contract.TOKEN_MINT_END_TIMESTAMP)
    ).toNumber();
    return timestamp;
  }

  public async getArrival(arrivalId: number): Promise<QueuedArrival | undefined> {
    const rawArrival = await this.makeCall(this.contract.planetArrivals, [arrivalId]);
    return decodeArrival(rawArrival);
  }

  public async getArrivalsForPlanet(planetId: LocationId): Promise<QueuedArrival[]> {
    const events = (
      await this.makeCall(this.contract.getPlanetArrivals, [locationIdToDecStr(planetId)])
    ).map(decodeArrival);

    return events;
  }

  public async getAllArrivals(
    planetsToLoad: LocationId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<QueuedArrival[]> {
    const arrivalsUnflattened = await aggregateBulkGetter<QueuedArrival[]>(
      planetsToLoad.length,
      200,
      async (start, end) => {
        return (
          await this.makeCall(this.contract.bulkGetPlanetArrivalsByIds, [
            planetsToLoad.slice(start, end).map(locationIdToDecStr),
          ])
        ).map((arrivals) => arrivals.map(decodeArrival));
      },
      onProgress
    );

    return _.flatten(arrivalsUnflattened);
  }

  public async getTouchedPlanetIds(
    startingAt: number,
    onProgress?: (fractionCompleted: number) => void
  ): Promise<LocationId[]> {
    const nPlanets: number = (await this.makeCall<EthersBN>(this.contract.getNPlanets)).toNumber();

    const planetIds = await aggregateBulkGetter<EthersBN>(
      nPlanets - startingAt,
      1000,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetPlanetIds, [start + startingAt, end + startingAt]),
      onProgress
    );
    return planetIds.map(locationIdFromEthersBN);
  }

  public async getRevealedCoordsByIdIfExists(
    planetId: LocationId
  ): Promise<RevealedCoords | undefined> {
    const decStrId = locationIdToDecStr(planetId);
    const rawRevealedCoords = await this.makeCall(this.contract.revealedCoords, [decStrId]);
    const ret = decodeRevealedCoords(rawRevealedCoords);
    if (ret.hash === EMPTY_LOCATION_ID) {
      return undefined;
    }
    return ret;
  }

  public async getIsPaused(): Promise<boolean> {
    return this.makeCall(this.contract.paused);
  }

  public async getRevealedPlanetsCoords(
    startingAt: number,
    onProgressIds?: (fractionCompleted: number) => void,
    onProgressCoords?: (fractionCompleted: number) => void
  ): Promise<RevealedCoords[]> {
    const nRevealedPlanets: number = (
      await this.makeCall<EthersBN>(this.contract.getNRevealedPlanets)
    ).toNumber();

    const rawRevealedPlanetIds = await aggregateBulkGetter<EthersBN>(
      nRevealedPlanets - startingAt,
      500,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetRevealedPlanetIds, [
          start + startingAt,
          end + startingAt,
        ]),
      onProgressIds
    );

    const rawRevealedCoords = await aggregateBulkGetter(
      rawRevealedPlanetIds.length,
      500,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetRevealedCoordsByIds, [
          rawRevealedPlanetIds.slice(start, end),
        ]),
      onProgressCoords
    );

    return rawRevealedCoords.map(decodeRevealedCoords);
  }

  public async bulkGetPlanets(
    toLoadPlanets: LocationId[],
    onProgressPlanet?: (fractionCompleted: number) => void,
    onProgressMetadata?: (fractionCompleted: number) => void
  ): Promise<Map<LocationId, Planet>> {
    const rawPlanets = await aggregateBulkGetter(
      toLoadPlanets.length,
      200,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetPlanetsByIds, [
          toLoadPlanets.slice(start, end).map(locationIdToDecStr),
        ]),
      onProgressPlanet
    );

    const rawPlanetsExtendedInfo = await aggregateBulkGetter(
      toLoadPlanets.length,
      200,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetPlanetsExtendedInfoByIds, [
          toLoadPlanets.slice(start, end).map(locationIdToDecStr),
        ]),
      (fractionCompleted) => {
        if (!onProgressMetadata) return;
        onProgressMetadata(fractionCompleted / 2);
      }
    );

    const rawPlanetsExtendedInfo2 = await aggregateBulkGetter(
      toLoadPlanets.length,
      200,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetPlanetsExtendedInfo2ByIds, [
          toLoadPlanets.slice(start, end).map(locationIdToDecStr),
        ]),
      (fractionCompleted) => {
        if (!onProgressMetadata) return;
        onProgressMetadata(0.5 + fractionCompleted / 2);
      }
    );

    const planets: Map<LocationId, Planet> = new Map();

    for (let i = 0; i < toLoadPlanets.length; i += 1) {
      if (!!rawPlanets[i] && !!rawPlanetsExtendedInfo[i]) {
        const planet = decodePlanet(
          locationIdToDecStr(toLoadPlanets[i]),
          rawPlanets[i],
          rawPlanetsExtendedInfo[i],
          rawPlanetsExtendedInfo2[i]
        );
        planet.transactions = new TxCollection();
        planets.set(planet.locationId, planet);
      }
    }
    return planets;
  }

  public async planetLevelFromHexPerlin(hex: LocationId, perlin: number): Promise<PlanetLevel> {
    const contractConstants = await this.getConstants();
    const spaceType = await this.spaceTypeFromPerlin(perlin);

    const levelBigInt = getBytesFromHex(hex, 4, 7);

    let ret = MIN_PLANET_LEVEL;

    for (let type = MAX_PLANET_LEVEL; type >= MIN_PLANET_LEVEL; type--) {
      if (levelBigInt < bigInt(contractConstants.planetLevelThresholds[type])) {
        ret = type;
        break;
      }
    }

    if (spaceType === SpaceType.NEBULA && ret > PlanetLevel.FOUR) {
      ret = PlanetLevel.FOUR;
    }
    if (spaceType === SpaceType.SPACE && ret > PlanetLevel.FIVE) {
      ret = PlanetLevel.FIVE;
    }
    if (ret > contractConstants.MAX_NATURAL_PLANET_LEVEL) {
      ret = contractConstants.MAX_NATURAL_PLANET_LEVEL as PlanetLevel;
    }

    return ret;
  }

  public async spaceTypeFromPerlin(perlin: number): Promise<SpaceType> {
    const contractConstants = await this.getConstants();
    if (perlin < contractConstants.PERLIN_THRESHOLD_1) {
      return SpaceType.NEBULA;
    } else if (perlin < contractConstants.PERLIN_THRESHOLD_2) {
      return SpaceType.SPACE;
    } else if (perlin < contractConstants.PERLIN_THRESHOLD_3) {
      return SpaceType.DEEP_SPACE;
    } else {
      return SpaceType.DEAD_SPACE;
    }
  }

  public static getSilverNeeded(planet: Planet): number {
    const totalLevel = planet.upgradeState.reduce((a, b) => a + b);
    return (totalLevel + 1) * 0.2 * planet.silverCap;
  }

  public static planetCanUpgrade(planet: Planet): boolean {
    const totalRank = planet.upgradeState.reduce((a, b) => a + b);
    if (planet.spaceType === SpaceType.NEBULA && totalRank >= 3) return false;
    if (planet.spaceType === SpaceType.SPACE && totalRank >= 4) return false;
    if (planet.spaceType === SpaceType.DEEP_SPACE && totalRank >= 5) return false;
    if (planet.spaceType === SpaceType.DEAD_SPACE && totalRank >= 5) return false;
    return (
      planet.planetLevel !== 0 &&
      planet.planetType === PlanetType.PLANET &&
      planet.silver >= this.getSilverNeeded(planet)
    );
  }

  public async planetTypeFromHexPerlin(hex: LocationId, perlin: number): Promise<PlanetType> {
    // level must be sufficient - too low level planets have 0 silver growth
    const planetLevel = await this.planetLevelFromHexPerlin(hex, perlin);
    const contractConstants = await this.getConstants();

    const spaceType = await this.spaceTypeFromPerlin(perlin);
    const weights = contractConstants.PLANET_TYPE_WEIGHTS[spaceType][planetLevel];
    const weightSum = weights.reduce((x, y) => x + y);
    let thresholds = [weightSum - weights[0]];
    for (let i = 1; i < weights.length; i++) {
      thresholds.push(thresholds[i - 1] - weights[i]);
    }
    thresholds = thresholds.map((x) => Math.floor((x * 256) / weightSum));
    const typeByte = Number(getBytesFromHex(hex, 8, 9));
    for (let i = 0; i < thresholds.length; i++) {
      if (typeByte >= thresholds[i]) {
        return i as PlanetType;
      }
    }
    // this should never happen
    return PlanetType.PLANET;
  }

  private async getBiome(loc: WorldLocation): Promise<Biome> {
    const contractConstants = await this.getConstants();
    const { perlin, biomebase } = loc;
    const spaceType = await this.spaceTypeFromPerlin(perlin);

    if (spaceType === SpaceType.DEAD_SPACE) return Biome.CORRUPTED;

    let biome = 3 * spaceType;
    if (biomebase < contractConstants.BIOME_THRESHOLD_1) biome += 1;
    else if (biomebase < contractConstants.BIOME_THRESHOLD_2) biome += 2;
    else biome += 3;

    return biome as Biome;
  }

  private async getDefaultPlanet(location: WorldLocation): Promise<LocatablePlanet> {
    const contractConstants = await this.getConstants();
    const { perlin } = location;
    const hex = location.hash;
    const planetLevel = await this.planetLevelFromHexPerlin(hex, perlin);
    const planetType = await this.planetTypeFromHexPerlin(hex, perlin);
    const spaceType = await this.spaceTypeFromPerlin(perlin);

    const [energyCapBonus, energyGroBonus, rangeBonus, speedBonus, defBonus, spaceJunkBonus] =
      bonusFromHex(hex);

    let energyCap = contractConstants.defaultPopulationCap[planetLevel];
    let energyGro = contractConstants.defaultPopulationGrowth[planetLevel];
    let range = contractConstants.defaultRange[planetLevel];
    let speed = contractConstants.defaultSpeed[planetLevel];
    let defense = contractConstants.defaultDefense[planetLevel];
    let silCap = contractConstants.defaultSilverCap[planetLevel];
    let spaceJunk = contractConstants.PLANET_LEVEL_JUNK[planetLevel];

    let silGro = 0;
    if (planetType === PlanetType.SILVER_MINE) {
      silGro = contractConstants.defaultSilverGrowth[planetLevel];
    }

    energyCap *= energyCapBonus ? 2 : 1;
    energyGro *= energyGroBonus ? 2 : 1;
    range *= rangeBonus ? 2 : 1;
    speed *= speedBonus ? 2 : 1;
    defense *= defBonus ? 2 : 1;
    spaceJunk = Math.floor(spaceJunk / (spaceJunkBonus ? 2 : 1));

    if (spaceType === SpaceType.DEAD_SPACE) {
      range *= 2;
      speed *= 2;
      energyCap *= 2;
      energyGro *= 2;
      silCap *= 2;
      silGro *= 2;

      defense = Math.floor((defense * 3) / 20);
    } else if (spaceType === SpaceType.DEEP_SPACE) {
      range *= 1.5;
      speed *= 1.5;
      energyCap *= 1.5;
      energyGro *= 1.5;
      silCap *= 1.5;
      silGro *= 1.5;

      defense *= 0.25;
    } else if (spaceType === SpaceType.SPACE) {
      range *= 1.25;
      speed *= 1.25;
      energyCap *= 1.25;
      energyGro *= 1.25;
      silCap *= 1.25;
      silGro *= 1.25;

      defense *= 0.5;
    }

    // apply stat modifiers for special planet types
    if (planetType === PlanetType.SILVER_MINE) {
      silCap *= 2;
      defense *= 0.5;
    } else if (planetType === PlanetType.SILVER_BANK) {
      speed /= 2;
      silCap *= 10;
      energyGro = 0;
      energyCap *= 5;
    } else if (planetType === PlanetType.TRADING_POST) {
      defense *= 0.5;
      silCap *= 2;
    }

    let pirates = (energyCap * contractConstants.defaultBarbarianPercentage[planetLevel]) / 100;
    // increase pirates
    if (spaceType === SpaceType.DEAD_SPACE) pirates *= 20;
    else if (spaceType === SpaceType.DEEP_SPACE) pirates *= 10;
    else if (spaceType === SpaceType.SPACE) pirates *= 4;

    if (planetType === PlanetType.SILVER_BANK) pirates /= 2;

    const silver = planetType === PlanetType.SILVER_MINE ? silCap / 2 : 0;

    speed *= contractConstants.TIME_FACTOR_HUNDREDTHS / 100;
    energyGro *= contractConstants.TIME_FACTOR_HUNDREDTHS / 100;
    silGro *= contractConstants.TIME_FACTOR_HUNDREDTHS / 100;

    const biome = this.getBiome(location);

    return {
      locationId: hex,
      perlin,
      spaceType,
      owner: EMPTY_ADDRESS,
      hatLevel: 0,
      bonus: bonusFromHex(hex),

      planetLevel,
      planetType,
      isHomePlanet: false,

      energyCap: energyCap,
      energyGrowth: energyGro,

      silverCap: silCap,
      silverGrowth: silGro,

      range,
      speed,
      defense,

      energy: pirates,
      silver,

      spaceJunk,

      lastUpdated: Math.floor(Date.now() / 1000),

      upgradeState: [0, 0, 0],

      transactions: new TxCollection(),
      unconfirmedClearEmoji: false,
      unconfirmedAddEmoji: false,
      loadingServerState: false,
      silverSpent: 0,

      prospectedBlockNumber: undefined,
      heldArtifactIds: [],
      destroyed: false,
      isInContract: false,
      syncedWithContract: false,
      needsServerRefresh: false,
      coordsRevealed: false,
      location,
      biome: await biome,
      hasTriedFindingArtifact: false,
      messages: undefined,
      pausers: 0,

      invader: EMPTY_ADDRESS,
      capturer: EMPTY_ADDRESS,
    };
  }

  public async bulkGetDefaultPlanets(
    toLoadPlanets: LocationId[],
    onProgressPlanet?: (fractionCompleted: number) => void,
    onProgressMetadata?: (fractionCompleted: number) => void
  ): Promise<Map<LocationId, Planet>> {
    const defaultPlanets = await this.bulkGetPlanets(
      toLoadPlanets,
      onProgressPlanet,
      onProgressMetadata
    );

    for (const locationId of defaultPlanets.keys()) {
      const planet = <LocatablePlanet>defaultPlanets.get(locationId)!;

      if (!('location' in planet)) {
        continue;
      }

      defaultPlanets.set(locationId, await this.getDefaultPlanet(planet.location));
    }

    return defaultPlanets;
  }

  public async getPlanetById(planetId: LocationId): Promise<Planet | undefined> {
    const decStrId = locationIdToDecStr(planetId);
    const rawExtendedInfo = await this.makeCall(this.contract.planetsExtendedInfo, [decStrId]);
    const rawExtendedInfo2 = await this.makeCall(this.contract.planetsExtendedInfo2, [decStrId]);

    if (!rawExtendedInfo[0]) return undefined; // planetExtendedInfo.isInitialized is false
    if (!rawExtendedInfo2[0]) return undefined; // planetExtendedInfo.isInitialized is false
    const rawPlanet = await this.makeCall(this.contract.planets, [decStrId]);
    return decodePlanet(decStrId, rawPlanet, rawExtendedInfo, rawExtendedInfo2);
  }

  public async getArtifactById(artifactId: ArtifactId): Promise<Artifact | undefined> {
    const exists = await this.makeCall<boolean>(this.contract.doesArtifactExist, [
      artifactIdToDecStr(artifactId),
    ]);
    if (!exists) return undefined;
    const rawArtifact = await this.makeCall(this.contract.getArtifactById, [
      artifactIdToDecStr(artifactId),
    ]);

    const artifact = decodeArtifact(rawArtifact);
    artifact.transactions = new TxCollection();
    return artifact;
  }

  public async bulkGetArtifactsOnPlanets(
    locationIds: LocationId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Artifact[][]> {
    const rawArtifacts = await aggregateBulkGetter(
      locationIds.length,
      200,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetPlanetArtifacts, [
          locationIds.slice(start, end).map(locationIdToDecStr),
        ]),
      onProgress
    );

    return rawArtifacts.map((rawArtifactArray) => {
      return rawArtifactArray.map(decodeArtifact);
    });
  }

  public async bulkGetArtifacts(
    artifactIds: ArtifactId[],
    onProgress?: (fractionCompleted: number) => void
  ): Promise<Artifact[]> {
    const rawArtifacts = await aggregateBulkGetter(
      artifactIds.length,
      200,
      async (start, end) =>
        await this.makeCall(this.contract.bulkGetArtifactsByIds, [
          artifactIds.slice(start, end).map(artifactIdToDecStr),
        ]),
      onProgress
    );

    const ret: Artifact[] = rawArtifacts.map(decodeArtifact);
    ret.forEach((a) => (a.transactions = new TxCollection()));

    return ret;
  }

  public async getPlayerArtifacts(
    playerId?: EthAddress,
    onProgress?: (percent: number) => void
  ): Promise<Artifact[]> {
    if (playerId === undefined) return [];

    const myArtifactIds = (await this.makeCall(this.contract.getPlayerArtifactIds, [playerId])).map(
      artifactIdFromEthersBN
    );
    return this.bulkGetArtifacts(myArtifactIds, onProgress);
  }

  public setDiagnosticUpdater(diagnosticUpdater?: DiagnosticUpdater) {
    this.contractCaller.setDiagnosticUpdater(diagnosticUpdater);
    this.txExecutor?.setDiagnosticUpdater(diagnosticUpdater);
    this.ethConnection.setDiagnosticUpdater(diagnosticUpdater);
  }

  public async submitTransaction<T extends TxIntent>(
    txIntent: T,
    overrides?: providers.TransactionRequest
  ): Promise<Transaction<T>> {
    const queuedTx = await this.txExecutor.queueTransaction(txIntent, overrides);

    this.emit(ContractsAPIEvent.TxQueued, queuedTx);
    // TODO: Why is this setTimeout here? Can it be removed?
    setTimeout(() => this.emitTransactionEvents(queuedTx), 0);

    return queuedTx;
  }

  /**
   * Remove a transaction from the queue.
   */
  public cancelTransaction(tx: Transaction): void {
    this.txExecutor.dequeueTransction(tx);
    this.emit(ContractsAPIEvent.TxCancelled, tx);
  }

  /**
   * Make sure this transaction is the next to be executed.
   */
  public prioritizeTransaction(tx: Transaction): void {
    this.txExecutor.prioritizeTransaction(tx);
    this.emit(ContractsAPIEvent.TxPrioritized, tx);
  }

  /**
   * This is a strange interface between the transaction queue system and the rest of the game. The
   * strange thing about it is that introduces another way by which transactions are pushed into the
   * game - these {@code ContractsAPIEvent} events.
   */
  public emitTransactionEvents(tx: Transaction): void {
    tx.submittedPromise
      .then(() => {
        this.emit(ContractsAPIEvent.TxSubmitted, tx);
      })
      .catch(() => {
        this.emit(ContractsAPIEvent.TxErrored, tx);
      });

    tx.confirmedPromise
      .then(() => {
        this.emit(ContractsAPIEvent.TxConfirmed, tx);
      })
      .catch(() => {
        this.emit(ContractsAPIEvent.TxErrored, tx);
      });
  }

  public getAddress() {
    return this.ethConnection.getAddress();
  }
}

export async function makeContractsAPI({
  connection,
  contractAddress,
}: ContractsApiConfig): Promise<ContractsAPI> {
  await connection.loadContract(contractAddress, loadDiamondContract);

  return new ContractsAPI({ connection, contractAddress });
}
