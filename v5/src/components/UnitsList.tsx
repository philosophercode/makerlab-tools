import type { MakerLabUnit } from "./catalog-types";

interface UnitsListProps {
  units: MakerLabUnit[];
}

export function UnitsList({ units }: UnitsListProps) {
  return (
    <section className="units-panel" aria-labelledby="units-heading">
      <div className="section-heading">
        <p className="eyebrow">LINKED UNITS</p>
        <h2 id="units-heading">Physical Machines</h2>
      </div>
      <div className="unit-list">
        {units.map((unit) => (
          <article className="unit-row" key={unit.id}>
            <div>
              <h3>{unit.name}</h3>
              <p>{unit.location}</p>
            </div>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>
                  <span
                    className={unit.status === "In Use" ? "live-dot" : "status-square"}
                    aria-hidden="true"
                  />
                  {unit.status}
                </dd>
              </div>
              <div>
                <dt>Serial</dt>
                <dd>{unit.serial}</dd>
              </div>
              <div>
                <dt>Condition</dt>
                <dd>{unit.condition}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
