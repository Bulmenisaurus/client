import { Planet, PlanetType } from '@darkforest_eth/types';
import React from 'react';
import styled from 'styled-components';
import { ProcgenUtils } from '../../Backend/Procedural/ProcgenUtils';
import { Wrapper } from '../../Backend/Utils/Wrapper';
import { StatIdx } from '../../_types/global/GlobalTypes';
import { AlignCenterHorizontally, EmSpacer, InlineBlock } from '../Components/CoreUI';
import {
  DefenseIcon,
  EnergyGrowthIcon,
  EnergyIcon,
  RangeIcon,
  SilverGrowthIcon,
  SilverIcon,
  SpeedIcon,
} from '../Components/Icons';
import {
  DefenseText,
  EnergyGrowthText,
  PlanetBiomeTypeLabelAnim,
  PlanetEnergyLabel,
  PlanetLevel,
  PlanetRank,
  PlanetSilverLabel,
  RangeText,
  SilverGrowthText,
  SpeedText,
} from '../Components/Labels/PlanetLabels';
import { Sub } from '../Components/Text';
import { TextPreview } from '../Components/TextPreview';
import { TooltipName } from '../Game/WindowManager';
import { PlanetIcons } from '../Renderers/PlanetscapeRenderer/PlanetIcons';
import dfstyles, { snips } from '../Styles/dfstyles';
import { useActiveArtifact, useUIManager } from '../Utils/AppHooks';
import {
  DestroyedMarker,
  PlanetActiveArtifact,
  RowTip,
  SpreadApart,
  TimesTwo,
  TitleBar,
} from './PlanetCardComponents';

export function PlanetCardTitle({
  planet,
  small,
}: {
  planet: Wrapper<Planet | undefined>;
  small?: boolean;
}) {
  if (!planet.value) return <></>;
  if (small) return <>{ProcgenUtils.getPlanetName(planet.value)}</>;

  return (
    <AlignCenterHorizontally style={{ width: 'initial', display: 'inline-flex' }}>
      {planet.value.destroyed && (
        <>
          <DestroyedMarker />
          <EmSpacer width={0.5} />
        </>
      )}
      {ProcgenUtils.getPlanetName(planet.value)}
      <EmSpacer width={0.5} />
      <PlanetIcons planet={planet.value} />
    </AlignCenterHorizontally>
  );
}

const StatsContainer = styled.div`
  ${snips.bigPadding}
  ${snips.roundedBordersWithEdge}
  border-color: ${dfstyles.colors.borderDarker};
  background-color: ${dfstyles.colors.backgroundlight};
  margin-top: 8px;
  margin-bottom: 8px;
`;

/** Preview basic planet information - used in `PlanetContextPane` and `HoverPlanetPane` */
export function PlanetCard({
  planetWrapper: p,
  standalone,
}: {
  planetWrapper: Wrapper<Planet | undefined>;
  standalone?: boolean;
}) {
  const uiManager = useUIManager();
  const active = useActiveArtifact(p, uiManager);
  const planet = p.value;

  return (
    <>
      {standalone && (
        <TitleBar>
          <PlanetCardTitle planet={p} />
        </TitleBar>
      )}
      <div style={{ padding: standalone ? '8px' : undefined }}>
        <AlignCenterHorizontally style={{ justifyContent: 'space-between' }}>
          <InlineBlock>
            <PlanetLevel planet={planet} />
            <EmSpacer width={0.5} />
            <PlanetRank planet={planet} />
            <EmSpacer width={0.5} />
            <PlanetBiomeTypeLabelAnim planet={planet} />
            <EmSpacer width={0.5} />
          </InlineBlock>
        </AlignCenterHorizontally>

        {active && (
          <>
            <EmSpacer height={0.5} />
            <PlanetActiveArtifact artifact={active} planet={planet} />
          </>
        )}

        <StatsContainer>
          <StatRow>
            <RowTip name={TooltipName.Energy}>
              <AlignCenterHorizontally>
                <EnergyIcon color={dfstyles.colors.subtext} />
                <EmSpacer width={0.5} />
                <Sub>energy</Sub>
                <EmSpacer width={0.5} />
                <PlanetEnergyLabel planet={planet} />
                {planet?.bonus && planet.bonus[StatIdx.EnergyCap] && <TimesTwo />}
              </AlignCenterHorizontally>
            </RowTip>
            <EmSpacer width={1} />

            <RowTip name={TooltipName.EnergyGrowth}>
              <AlignCenterHorizontally>
                <EnergyGrowthIcon color={dfstyles.colors.subtext} />
                <EmSpacer width={0.5} />
                <Sub>growth</Sub>
                <EmSpacer width={0.5} />
                <EnergyGrowthText planet={planet} />
                {planet?.bonus && planet.bonus[StatIdx.EnergyGro] && <TimesTwo />}
              </AlignCenterHorizontally>
            </RowTip>
          </StatRow>

          <StatRow>
            <RowTip name={TooltipName.Silver}>
              <AlignCenterHorizontally>
                <SilverIcon color={dfstyles.colors.subtext} />
                <EmSpacer width={0.5} />
                <Sub>silver</Sub>
                <EmSpacer width={0.5} />
                <PlanetSilverLabel planet={planet} />
              </AlignCenterHorizontally>
            </RowTip>
            {(p.value?.planetType === PlanetType.SILVER_MINE && (
              <>
                <EmSpacer width={1} />
                <RowTip name={TooltipName.SilverGrowth}>
                  <AlignCenterHorizontally>
                    <SilverGrowthIcon color={dfstyles.colors.subtext} />
                    <EmSpacer width={0.5} />
                    <Sub>growth</Sub>
                    <EmSpacer width={0.5} />
                    <SilverGrowthText planet={p.value} />
                  </AlignCenterHorizontally>
                </RowTip>
              </>
            )) || <></>}
          </StatRow>

          <StatRow>
            <RowTip name={TooltipName.Defense}>
              <AlignCenterHorizontally>
                <DefenseIcon color={dfstyles.colors.subtext} />
                <EmSpacer width={0.5} />
                <Sub>defense</Sub>
                <EmSpacer width={0.5} />
                <DefenseText planet={planet} />
                {planet?.bonus && planet.bonus[StatIdx.Defense] && <TimesTwo />}
              </AlignCenterHorizontally>
            </RowTip>
          </StatRow>

          <StatRow>
            <RowTip name={TooltipName.Speed}>
              <AlignCenterHorizontally>
                <SpeedIcon color={dfstyles.colors.subtext} />
                <EmSpacer width={0.5} />
                <Sub>speed</Sub>
                <EmSpacer width={0.5} />
                <SpeedText planet={planet} />
                {planet?.bonus && planet.bonus[StatIdx.Speed] && <TimesTwo />}
              </AlignCenterHorizontally>
            </RowTip>
          </StatRow>

          <StatRow>
            <RowTip name={TooltipName.Range}>
              <AlignCenterHorizontally>
                <RangeIcon color={dfstyles.colors.subtext} />
                <EmSpacer width={0.5} />
                <Sub>range</Sub>
                <EmSpacer width={0.5} />
                <RangeText planet={planet} />
                {planet?.bonus && planet.bonus[StatIdx.Range] && <TimesTwo />}
              </AlignCenterHorizontally>
            </RowTip>
          </StatRow>
        </StatsContainer>

        <SpreadApart>
          <Sub>owner address</Sub>
          <TextPreview
            style={{ color: dfstyles.colors.subtext }}
            text={planet?.owner}
            focusedWidth={'150px'}
            unFocusedWidth={'150px'}
          />{' '}
        </SpreadApart>

        <SpreadApart>
          <Sub>planet id</Sub>
          <TextPreview
            style={{ color: dfstyles.colors.subtext }}
            text={planet?.locationId}
            focusedWidth={'150px'}
            unFocusedWidth={'150px'}
          />
        </SpreadApart>
      </div>
    </>
  );
}

const StatRow = styled(AlignCenterHorizontally)`
  ${snips.roundedBorders}
  display: inline-block;
  box-sizing: border-box;
  width: 100%;

  path {
    fill: ${dfstyles.colors.subtext};
  }
`;
