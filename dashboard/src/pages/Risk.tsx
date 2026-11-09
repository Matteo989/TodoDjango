import { usePoll } from "../api";
import { Card, Meter, Stat, Empty, ErrorNote } from "../components/ui";
import { fmtEur, fmtSigned, fmtPctPlain, fmtPrice } from "../format";

export default function Risk() {
  const { data, error } = usePoll<any>("/risk", 10000, ["position"]);
  const snap = data?.snapshot;
  const l = data?.limits;
  const dayLoss = Math.max(0, -(snap?.dailyPnl ?? 0));
  const weekLoss = Math.max(0, -(snap?.weeklyPnl ?? 0));

  return (
    <div className="stack" style={{ gap: 14 }}>
      <ErrorNote error={error} />
      <div className={`notice ${snap?.canOpenNewPosition ? "info" : "warn"}`}>
        {snap?.canOpenNewPosition
          ? "✔ Les règles de risque autorisent l'ouverture d'une nouvelle position si un signal apparaît."
          : <><strong>Nouvelles positions bloquées :</strong> {snap?.blockingReasons?.join(" ")}</>}
      </div>

      <div className="grid cols-4">
        <Stat label="Capital exposé" value={fmtEur(snap?.exposure)} sub={`Maximum ${fmtEur(l?.maxTradingCapital)}`} />
        <Stat label="Risque des positions ouvertes" value={fmtEur(snap?.openRisk)} sub="Perte si tous les stops sont touchés" />
        <Stat label="Budget de risque du prochain trade" value={fmtEur(snap?.riskBudget)} sub={`Cible ${fmtEur(l?.riskPerTrade)} par transaction`} />
        <Stat label="Capital disponible" value={fmtEur(snap?.availableForTrading)} sub={`Réserve ${fmtEur(l?.reserve)} + marge ${fmtEur(l?.safetyMargin)} intouchables`} />
      </div>

      <div className="grid cols-2">
        <Card title="Pertes du jour" right={<span className="num">{fmtEur(dayLoss)} / {fmtEur(l?.maxDailyLoss)}</span>}>
          <Meter value={dayLoss} max={l?.maxDailyLoss ?? 1} invert />
          <div className="small muted" style={{ marginTop: 8 }}>Résultat du jour (réalisé + pertes latentes) : {fmtSigned(snap?.dailyPnl)}. Remise à zéro à minuit ({l?.timeZone}).</div>
        </Card>
        <Card title="Pertes de la semaine" right={<span className="num">{fmtEur(weekLoss)} / {fmtEur(l?.maxWeeklyLoss)}</span>}>
          <Meter value={weekLoss} max={l?.maxWeeklyLoss ?? 1} invert />
          <div className="small muted" style={{ marginTop: 8 }}>Résultat de la semaine : {fmtSigned(snap?.weeklyPnl)}. Remise à zéro le lundi.</div>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Limites de sécurité">
          <dl className="kv">
            <dt>Capital initial</dt><dd>{fmtEur(l?.initialCapital)}</dd>
            <dt>Capital maximum alloué au trading</dt><dd>{fmtEur(l?.maxTradingCapital)}</dd>
            <dt>Réserve</dt><dd>{fmtEur(l?.reserve)}</dd>
            <dt>Marge de sécurité</dt><dd>{fmtEur(l?.safetyMargin)}</dd>
            <dt>Risque par transaction</dt><dd>{fmtEur(l?.riskPerTrade)}</dd>
            <dt>Perte quotidienne maximale</dt><dd>{fmtEur(l?.maxDailyLoss)}</dd>
            <dt>Perte hebdomadaire maximale</dt><dd>{fmtEur(l?.maxWeeklyLoss)}</dd>
            <dt>Positions simultanées</dt><dd>{l?.maxOpenPositions}</dd>
            <dt>Frais taker / glissement</dt><dd>{fmtPctPlain(l?.takerFeeRate, 2)} / {fmtPctPlain(l?.slippageRate, 2)}</dd>
            <dt>Gain/risque net minimal</dt><dd>{l?.minNetRewardRisk}</dd>
            <dt>Part max. des frais dans le gain</dt><dd>{fmtPctPlain(l?.maxFeeShareOfReward, 0)}</dd>
            <dt>Effet de levier</dt><dd>Aucun (Spot uniquement)</dd>
          </dl>
        </Card>
        <Card title="Risque par position" flush>
          {data?.positions?.length ? (
            <table>
              <thead><tr><th>Actif</th><th className="r">Exposition</th><th className="r">Stop</th><th className="r">Risque initial</th></tr></thead>
              <tbody>{data.positions.map((p: any) => (
                <tr key={p.id}><td>{p.symbol}</td><td className="r">{fmtEur(p.exposure)}</td><td className="r">{fmtPrice(p.stopLoss)}</td><td className="r">{fmtEur(p.initialRisk)}</td></tr>
              ))}</tbody>
            </table>
          ) : <Empty>Aucune position ouverte : aucun capital exposé.</Empty>}
          <div className="small muted" style={{ padding: 16 }}>
            Règles permanentes : jamais de renforcement d'une position perdante, jamais d'augmentation du risque pour « se refaire », jamais d'augmentation automatique du capital engagé.
          </div>
        </Card>
      </div>
    </div>
  );
}
